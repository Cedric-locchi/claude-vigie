import { DOCUMENT, DestroyRef, Injectable,computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { AttentionService } from './core/attention.service';
import { ClaudeStatus, SessionSummary } from './core/models';
import { activityMax, describeSession, rank } from './core/session-view';
import { CLIENT_OS, isShortcut, restartCommand } from './core/platform';
import { duration } from './core/format';
import { VigieService, daemonError, isChat } from './core/vigie.service';
import { APP_VERSION } from './core/version';

const SPARK_H = 12;
const GROUPS = [
  { key: 'waiting', label: 'En attente' },
  { key: 'turn', label: 'À toi' },
  { key: 'running', label: 'En cours' },
  { key: 'done', label: "Terminées aujourd'hui" },
] as const;

/** Statut de Claude (status.claude.com) : libellé et ton de la pastille par indicateur. */
const CLAUDE_STATUS: Record<ClaudeStatus['indicator'], { label: string; tone: 'ok' | 'err' | 'neutral' }> = {
  none: { label: 'Claude opérationnel', tone: 'ok' },
  minor: { label: 'Claude : incident mineur', tone: 'neutral' },
  major: { label: 'Claude : panne partielle', tone: 'err' },
  critical: { label: 'Claude : panne majeure', tone: 'err' },
  maintenance: { label: 'Claude : maintenance', tone: 'neutral' },
  unknown: { label: 'Statut de Claude inconnu', tone: 'neutral' },
};

@Injectable()
export class AppVm {
  private readonly vigie = inject(VigieService);
  private readonly router = inject(Router);
  private readonly attention = inject(AttentionService);
  private readonly os = inject(CLIENT_OS);
  /** Raccourcis ⌘N / ⌘B affichés seulement sur mac. */
  // ponytail: raccourcis N et B absents hors mac (Chrome réserve Ctrl+N, Ctrl+B appartient au terminal) ; en ajouter (Alt+…) si demandé.
  readonly mac = this.os === 'mac';
  /** Version de l'app, sous Réglages dans la barre latérale. */
  readonly version = APP_VERSION;

  readonly connected = this.vigie.connected;
  readonly incompatible = this.vigie.incompatible;

  /** Horloge locale, toutes les secondes : l'âge des données continue d'avancer quand le daemon ne pousse plus rien. */
  private readonly clock = signal(Date.now());
  /** Instant de la perte de connexion (null : connecté). */
  private readonly lostAt = linkedSignal<boolean, number | null>({ source: this.connected, computation: (c) => (c ? null : Date.now()) });
  /**
   * Daemon injoignable alors qu'un état est affiché : bandeau global et état atténué (ne jamais faire passer un état figé pour vivant).
   * 3 s de grâce : une reconnexion après une veille ou un redémarrage du daemon ne fait pas clignoter le bandeau.
   * Avant le premier snapshot, c'est la page qui l'explique (rien d'affiché ne serait périmé).
   */
  readonly offline = computed(() => {
    const at = this.lostAt();
    const snap = this.vigie.snapshot();
    if (at === null || !snap || this.clock() - at < 3000) return null;
    const age = Math.max(0, this.clock() - snap.now);
    return { age: age < 60_000 ? `${Math.max(1, Math.round(age / 1000))} s` : duration(age) };
  });
  /** Commande pour relancer le service du daemon, selon l'OS du client. */
  readonly restartCommand = restartCommand(this.os);
  readonly now = computed(() => this.vigie.snapshot()?.now ?? 0);
  readonly sessions = computed(() => this.vigie.snapshot()?.sessions ?? []);
  readonly active = computed(() => this.sessions().filter((s) => s.state !== 'done'));
  readonly waitingCount = computed(() => this.sessions().filter((s) => s.state === 'waiting').length);

  /** URL courante en signal : la sidebar sait quelle page et quelle session sont ouvertes (app sans zone.js). */
  readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)), { initialValue: this.router.url });
  readonly page = computed(() => this.url().split(/[?#]/)[0]);
  /** Session affichée, si on est sur sa page. */
  readonly activeId = computed(() => this.page().match(/^\/sessions\/([^/]+)/)?.[1] ?? null);

  /** Filtre de la sidebar : titre, projet ou branche. */
  readonly filter = signal('');
  /** Terminées repliées par défaut : la sidebar sert d'abord à suivre ce qui tourne. */
  readonly doneOpen = signal(false);

  /** Sessions de la sidebar, groupées par état ; dans chaque groupe, ordre de démarrage (la plus récente d'abord) : stable, une session qui bouge ne change pas de place. */
  readonly groups = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const startOfDay = new Date(this.now()).setHours(0, 0, 0, 0);
    const list = this.sessions()
      .filter((s) => s.state !== 'done' || s.lastTs >= startOfDay)
      .filter((s) => !q || `${s.title} ${s.project} ${s.branch ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || b.firstTs - a.firstTs);
    const max = activityMax(list);
    const groups: { key: string; label: string; rows: ReturnType<typeof describeSession>[] }[] = GROUPS
      .map((g) => ({ ...g, rows: list.filter((s) => s.state === g.key).map((s) => describeSession(s, this.now(), max, SPARK_H)) }))
      .filter((g) => g.rows.length);
    // La session ouverte reste visible même si elle est filtrée ou terminée un autre jour.
    const open = this.sessions().find((s) => s.id === this.activeId());
    if (open && !list.includes(open)) groups.unshift({ key: 'open', label: 'Session ouverte', rows: [describeSession(open, this.now(), max, SPARK_H)] });
    return groups;
  });

  /** Indicateurs compacts en tête de sidebar. */
  readonly pulse = computed(() => {
    const u = this.vigie.snapshot()?.usage;
    const w = u?.window;
    return {
      todayCost: u?.today.cost ?? 0,
      window: w?.active ? { pct: w.pct, bar: Math.min(100, w.pct * 100), limitAt: w.limitAt } : null,
    };
  });

  /** Statut public de Claude ; null tant que le daemon ne l'a pas relevé. */
  readonly claudeStatus = computed(() => {
    const s = this.vigie.snapshot()?.claudeStatus;
    return s ? { ...CLAUDE_STATUS[s.indicator], incidents: s.incidents } : null;
  });

  constructor() {
    const id = setInterval(() => this.clock.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  setFilter(q: string): void {
    this.filter.set(q);
  }

  toggleDone(): void {
    this.doneOpen.update((open) => !open);
  }

  /** Échec de la dernière réponse rapide, sur la ligne de la session concernée (partagé avec la cloche, les toasts, le Dashboard). */
  readonly replyError = this.attention.replyError.asReadonly();

  /** Autorisation rapide depuis la sidebar : la touche est tapée dans le terminal claude de la session. */
  allow(s: SessionSummary): Promise<void> {
    return this.attention.reply(s.id, 'allow');
  }

  readonly chatError = signal<string | null>(null);
  private chatStarting = false;

  /** La page affichée est une discussion : « Discussion » est actif, et ne relance pas une deuxième discussion. */
  readonly inChat = computed(() => isChat(this.sessions().find((s) => s.id === this.activeId())?.cwd));

  async newChat(): Promise<void> {
    if (this.chatStarting || this.inChat()) return;
    this.chatStarting = true;
    this.chatError.set(null);
    try {
      const term = await this.vigie.startChat();
      await this.router.navigate(['/sessions', term.sessionId]);
    } catch (e) {
      this.chatError.set(daemonError(e, 'Discussion impossible à lancer.'));
    } finally {
      this.chatStarting = false;
    }
  }

  newSession(event?: Event): void {
    event?.preventDefault();
    this.router.navigate(['/new']);
  }

  /** Palette de recherche dans les sessions (décision 049) : ouverte par ⌘F / Ctrl+F ou l'entrée « Rechercher » de la barre latérale. */
  readonly searchOpen = signal(false);
  readonly searchKey = this.mac ? '⌘F' : 'Ctrl+F';

  /**
   * ⌘F / Ctrl+F, écouté sur window (donc après les écouteurs de document des pages) : ignoré s'il est déjà pris (vue Fichiers :
   * recherche dans le fichier), tapé hors mac dans un terminal (Ctrl+F lui appartient : caractère suivant pour readline…) ou dans
   * un dialogue ouvert.
   */
  searchShortcut(e: KeyboardEvent): void {
    if (e.defaultPrevented || !isShortcut(e, 'f', this.mac)) return;
    const t = e.target instanceof Element ? e.target : null;
    if ((!this.mac && t?.closest('.xterm')) || t?.closest('dialog[open], [role=dialog], [role=alertdialog]')) return;
    e.preventDefault();
    this.openSearch();
  }

  openSearch(): void {
    this.searchOpen.set(true);
  }

  private readonly document = inject(DOCUMENT);

  /** La palette n'a pas pu se charger (fichier disparu après une mise à jour de l'UI) : recharge toute l'app. */
  reloadPage(): void {
    this.document.location.reload();
  }
}
