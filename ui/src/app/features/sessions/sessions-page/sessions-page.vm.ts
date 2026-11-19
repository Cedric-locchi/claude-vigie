import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionSummary } from '../../../core/models';
import { ConfirmService } from '../../../core/confirm.service';
import { CLIENT_OS } from '../../../core/platform';
import { KEYS, VigieService, sendReply } from '../../../core/vigie.service';
import { activityMax, describeSession } from '../../../core/session-view';
import { keepLast } from '../../../core/signals';
import { ACTIVITY_DAYS, WEEKS, activityGrid } from '../activity-grid/activity-grid';
import { dailyAverage, segments, sessionSegments, trend } from './dashboard';

const SPARK_H = 22;

@Injectable()
export class SessionsPageVm {
  private readonly vigie = inject(VigieService);
  /** ⌘N affiché seulement sur mac (voir AppVm.mac). */
  readonly mac = inject(CLIENT_OS) === 'mac';
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  readonly search = signal('');
  readonly snapshot = this.vigie.snapshot;
  readonly loading = computed(() => !this.snapshot());
  /** Délai de premier contact écoulé : « Connexion au daemon… » cède la place à la marche à suivre. */
  private readonly waitedTooLong = signal(false);
  /**
   * Premier lancement bloqué : aucun snapshot après 5 s et pas de connexion ouverte (daemon arrêté ou absent).
   * Un snapshot qui arrive ensuite remplace aussitôt le message (dérivé, rien à défaire).
   */
  readonly unreachable = computed(() => this.waitedTooLong() && this.loading() && !this.vigie.connected());

  constructor() {
    const timer = setTimeout(() => this.waitedTooLong.set(true), 5000);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
  readonly now = computed(() => this.snapshot()?.now ?? 0);
  readonly usage = computed(() => this.snapshot()?.usage ?? null);

  // --- Historique de consommation : une seule requête pour la heatmap et la moyenne des indicateurs ---
  /**
   * ponytail: toujours 53 semaines (ACTIVITY_DAYS = 371 j), quelle que soit la largeur de la heatmap : une requête qui
   * suivrait la largeur repartirait à chaque redimensionnement (et deux fois au démarrage). À revoir si l'historique pèse trop.
   * Les dernières lignes restent affichées pendant un rechargement (chaque minute) : pas de clignotement.
   */
  private readonly history = keepLast(this.vigie.usageResource(signal(ACTIVITY_DAYS)));
  private readonly usageRows = computed(() => this.history()?.rows ?? []);
  readonly historyLoaded = computed(() => this.history() !== null);

  /** Semaines de la heatmap, fixées par sa largeur (le composant la mesure). */
  readonly activityWeeks = signal(WEEKS);
  /** Heatmap des tokens par jour sur `activityWeeks` semaines ; null tant que l'historique n'est pas arrivé. */
  readonly activity = computed(() => {
    const h = this.history();
    return h ? activityGrid(h.rows, h.now, this.activityWeeks()) : null;
  });

  /** Seuil du coût du jour (Réglages), null sans seuil. */
  private readonly settings = this.vigie.settingsResource();
  private readonly dailyCost = computed(() => (this.settings.hasValue() ? this.settings.value()?.alerts?.dailyCost ?? null : null));

  private readonly sessions = computed(() => {
    const q = this.search().trim().toLowerCase();
    const all = this.snapshot()?.sessions ?? [];
    return q ? all.filter((s) => `${s.title} ${s.project} ${s.branch ?? ''}`.toLowerCase().includes(q)) : all;
  });

  readonly waiting = computed(() => this.sessions().filter((s) => s.state === 'waiting' || s.state === 'turn'));
  readonly running = computed(() => this.sessions().filter((s) => s.state === 'running'));
  readonly done = computed(() => {
    const startOfDay = new Date(this.now()).setHours(0, 0, 0, 0);
    return this.sessions().filter((s) => s.state === 'done' && s.lastTs >= startOfDay);
  });
  readonly activeCount = computed(() => this.waiting().length + this.running().length);

  /** Cartes d'indicateurs. */
  readonly kpis = computed(() => {
    const active = [...this.waiting(), ...this.running()];
    const usage = this.usage();
    const w = usage?.window;
    const threshold = this.dailyCost();
    const cost = usage?.today.cost ?? 0;
    const tokens = usage?.today.tokens ?? 0;
    const avg = this.historyLoaded() ? dailyAverage(this.usageRows(), this.now()) : null;
    return {
      blocked: this.waiting().filter((s) => s.state === 'waiting').length,
      turn: this.waiting().filter((s) => s.state === 'turn').length,
      running: this.running().length,
      doneToday: this.done().length,
      subagents: active.reduce((n, s) => n + s.activeSubagents, 0),
      todayCost: cost,
      todayTokens: tokens,
      cacheRate: usage?.today.cacheRate ?? 0,
      /** Moyenne des 7 jours précédents ; null tant que l'historique n'est pas arrivé. */
      avg,
      /** Flèches de tendance du jour face à la moyenne 7 j. */
      costTrend: trend(cost, avg?.cost),
      tokensTrend: trend(tokens, avg?.tokens),
      threshold,
      // Au-delà du seuil, toute la barre passe en rouge (comme le liseré du graphique de Consommation).
      costBar: threshold ? segments(cost / threshold, 20, cost > threshold ? 0 : 1) : null,
      cacheBar: segments(usage?.today.cacheRate ?? 0, 20),
      sessionBar: sessionSegments(this.rows().map((r) => r.s)),
      // Fenêtre : rouge au-delà de 80 % (la limite approche), secondaire avant.
      window: w?.active ? { pct: w.pct, end: w.end, limitAt: w.limitAt, bar: segments(w.pct, 20, 0.8) } : null,
    };
  });

  /**
   * Une seule liste, par date de création, la plus récente en haut : une session ne change jamais de place selon son état
   * (l'attente se voit au badge et aux actions de la ligne). L'activité est à la même échelle pour toutes.
   */
  readonly rows = computed(() => {
    const today = new Set(this.done());
    const list = this.sessions().filter((s) => s.state !== 'done' || today.has(s)).sort((a, b) => b.firstTs - a.firstTs);
    const max = activityMax(list);
    return list.map((s) => describeSession(s, this.now(), max, SPARK_H));
  });

  /** Ids cochés ; seuls ceux encore visibles comptent (une session disparue ou filtrée sort de la sélection). */
  private readonly picked = signal<ReadonlySet<string>>(new Set());
  readonly selected = computed(() => this.rows().filter((r) => this.picked().has(r.s.id)).map((r) => r.s));
  readonly selectedIds = computed(() => new Set(this.selected().map((s) => s.id)));
  readonly allSelected = computed(() => this.rows().length > 0 && this.selected().length === this.rows().length);
  readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());

  toggle(id: string, on: boolean): void {
    const next = new Set(this.selectedIds());
    if (on) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  /** Porte sur les lignes visibles (filtrées par la recherche). */
  toggleAll(on: boolean): void {
    this.picked.set(on ? new Set(this.rows().map((r) => r.s.id)) : new Set());
  }

  clearSelection(): void {
    this.picked.set(new Set());
  }

  /** Une seule confirmation, puis une suppression par session : un échec n'arrête pas les autres et reste coché. */
  async removeSelected(): Promise<void> {
    const list = this.selected();
    if (!list.length || !(await this.confirm.deleteSessions(list.length, list.some((s) => !!s.terminalId)))) return;
    const results = await Promise.allSettled(list.map((s) => this.vigie.deleteSession(s.id)));
    this.picked.set(new Set(list.filter((_, i) => results[i].status === 'rejected').map((s) => s.id)));
  }

  setSearch(term: string): void {
    this.search.set(term);
  }

  /** Échec de la dernière réponse rapide, affiché sur la ligne de la session concernée. */
  readonly replyError = signal<{ id: string; message: string } | null>(null);

  allow(s: SessionSummary): Promise<void> {
    return this.reply(s, KEYS.allow);
  }

  refuse(s: SessionSummary): Promise<void> {
    return this.reply(s, KEYS.refuse);
  }

  private async reply(s: SessionSummary, keys: string): Promise<void> {
    if (!s.terminalId) return;
    this.replyError.set(null);
    const message = await sendReply(this.vigie, s.terminalId, keys);
    if (message) this.replyError.set({ id: s.id, message });
  }

  /** Clic n'importe où sur une ligne : ouvre la session, sauf sur ses boutons/liens ou après une sélection de texte. */
  openRow(event: MouseEvent, id: string): void {
    if ((event.target as Element | null)?.closest('a, button, input')) return;
    if (event.view?.getSelection()?.toString()) return;
    this.router.navigate(['/sessions', id]);
  }

  /** Session lancée ailleurs : on la reprend dans Vigie puis on ouvre son terminal. */
  async resume(s: SessionSummary): Promise<void> {
    if (!(await this.confirm.resumeSession(s))) return;
    await this.vigie.resumeSession(s);
    await this.router.navigate(['/sessions', s.id]);
  }

  async remove(s: SessionSummary): Promise<void> {
    if (await this.confirm.deleteSession(s)) await this.vigie.deleteSession(s.id);
  }
}
