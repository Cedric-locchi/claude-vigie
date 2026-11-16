import { DOCUMENT, Injectable, Signal, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmService } from '../../../core/confirm.service';
import { SessionDetail, SessionState } from '../../../core/models';
import { KEYS, OUTDATED, VigieService, isChat, sendReply } from '../../../core/vigie.service';
import { stateLabel } from '../../../core/session-view';
import { hasMise, projectTasks } from '../mise/session-mise.vm';
import type { WaitBar } from '../agents/wait-bar/wait-bar.component';
import { counter, entering, keepLast } from '../../../core/signals';

/** Filtres de la liste des agents, dans l'ordre d'urgence. */
/** « Non terminés » regroupe ceux qui t'attendent (question, autorisation, fin de tour) et ceux qui tournent ;
 *  pas de puce « À toi » ni « En cours » à part : la rangée de filtres tient sur une ligne. */
const AGENT_FILTERS: { state: SessionState; label: string; states?: SessionState[] }[] = [
  { state: 'waiting', label: 'En attente' },
  { state: 'running', label: 'Non terminés', states: ['waiting', 'running', 'turn'] },
  { state: 'done', label: 'Terminés' },
];

export type SessionView = 'workspace' | 'diff' | 'files' | 'mise' | 'xcode' | 'history' | 'usage' | 'config';
/** Onglet Historique : la chronologie par tours ou le journal brut. */
export type HistoryMode = 'timeline' | 'log';

/**
 * Dernière vue choisie : survit au changement de session (même si la page est recréée en passant par la liste).
 * ponytail: mémoire du module, perdue au rechargement ; localStorage si on veut la garder entre deux lancements.
 */
let lastView: SessionView = 'workspace';

@Injectable()
export class SessionPageVm {
  private readonly vigie = inject(VigieService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly source = signal<Signal<string> | null>(null);

  readonly id = computed(() => this.source()?.() ?? null);
  readonly detailResource = this.vigie.sessionResource(this.id);
  /** Garde le dernier détail pendant les rechargements : pas de clignotement à chaque mise à jour. */
  readonly detail = linkedSignal<SessionDetail | undefined, SessionDetail | null>({
    source: () => (this.detailResource.hasValue() ? this.detailResource.value() : undefined),
    computation: (value, previous) => (value && value.summary.id === this.id() ? value : previous?.value?.summary.id === this.id() ? previous.value : null),
  });
  readonly notFound = computed(() => this.detailResource.status() === 'error' && !this.detail());
  /** Détail reçu mais hors contrat : ce n'est pas « introuvable », c'est un daemon d'une autre version. */
  readonly outdated = computed(() => this.notFound() && this.detailResource.error()?.message === OUTDATED);

  private readonly snapshot = this.vigie.snapshot;
  readonly now = computed(() => this.snapshot()?.now ?? 0);
  readonly summary = computed(() => this.detail()?.summary ?? this.snapshot()?.sessions.find((s) => s.id === this.id()) ?? null);
  readonly agents = computed(() => this.detail()?.agents ?? []);
  readonly terminals = computed(() => (this.snapshot()?.terminals ?? []).filter((t) => t.sessionId === this.id()));
  /** Lancée hors de Vigie : aucun terminal ici, la vue se réduit au monitoring. */
  readonly isExternal = computed(() => this.terminals().length === 0);
  /** Discussion sans projet : deux vues seulement, et supprimée pour de bon quand on la quitte. */
  readonly isChat = computed(() => isChat(this.summary()?.cwd));
  readonly claudeTerminal = computed(() => this.terminals().find((t) => t.kind === 'claude' && !t.exited) ?? null);

  readonly activeTab = linkedSignal<string[], string | null>({
    source: () => this.terminals().map((t) => t.id),
    computation: (ids, previous) => (previous?.value && ids.includes(previous.value) ? previous.value : ids[0] ?? null),
  });
  readonly activeTerminal = computed(() => this.terminals().find((t) => t.id === this.activeTab()) ?? null);

  /** Badge d'état à côté du titre (la variante de badge porte le nom de l'état). */
  readonly stateBadge = computed(() => {
    const s = this.summary();
    if (!s) return null;
    return { variant: s.state, label: stateLabel(s.state, s.reason, 'long') };
  });
  /** Agents en souci : badge à part, seulement s'il y en a. */
  readonly issues = computed(() => this.agents().filter((a) => a.issue).length);
  /** Barre d'attente au-dessus du terminal : la session attend et on peut répondre ici. Session externe : rien (pas de terminal). */
  readonly waitBar = computed((): WaitBar | null => {
    const s = this.summary();
    if (s?.state !== 'waiting' || !this.claudeTerminal()) return null;
    return { question: s.reason === 'question', canAllow: s.reason === 'permission', detail: s.detail ?? (s.reason === 'question' ? null : s.tool) };
  });
  readonly agentStats = computed(() => {
    const a = this.agents();
    return { running: a.filter((x) => x.state === 'running').length, waiting: a.filter((x) => x.state === 'waiting').length };
  });

  /** Consommation de la session : répartition des tokens, taux de cache et part de chaque agent. */
  readonly usage = computed(() => {
    const d = this.detail();
    const u = d?.usage;
    if (!d || !u) return null; // daemon d'avant cet onglet : pas encore de `usage`
    const total = u.input + u.output + u.cacheCreate + u.cacheRead;
    if (!total) return null;
    const inputSide = u.input + u.cacheCreate + u.cacheRead;
    const parts = [
      { key: 'cache-read', label: 'Cache lu', tokens: u.cacheRead },
      { key: 'cache-write', label: 'Cache écrit', tokens: u.cacheCreate },
      { key: 'input', label: 'Entrée', tokens: u.input },
      { key: 'output', label: 'Sortie', tokens: u.output },
    ].map((p) => ({ ...p, share: p.tokens / total }));
    const max = Math.max(1, ...d.agents.map((a) => a.tokens));
    const agents = [...d.agents].sort((a, b) => b.tokens - a.tokens).map((a) => ({ id: a.id, name: a.name, sub: a.sub, tokens: a.tokens, cost: a.cost, width: Math.round((a.tokens / max) * 100) }));
    return { total, calls: u.calls, context: u.context, cacheRate: inputSide ? u.cacheRead / inputSide : 0, parts, agents };
  });

  /** Onglet de premier niveau : terminal et agents, chronologie ou consommation en pleine page. */
  /** Une discussion n'a que Discussion et Consommation : on y arrive toujours sur Discussion. Ailleurs, on garde la dernière vue choisie. */
  readonly view = linkedSignal<boolean, SessionView>({ source: this.isChat, computation: (chat, prev) => (chat ? 'workspace' : prev && !prev.source ? prev.value : lastView) });
  private readonly rememberView = effect(() => {
    const view = this.view();
    // « Tâches mise » et « Xcode » ne sont pas retenues : la session suivante n'a peut-être ni l'un ni l'autre.
    if (!this.isChat() && view !== 'mise' && view !== 'xcode') lastView = view;
  });

  /** Agent affiché dans la sidebar de détail ; remis à zéro quand on change de session. */
  readonly openAgentId = linkedSignal<string | null, string | null>({ source: () => this.id(), computation: () => null });
  /** Suit les mises à jour du daemon : la sidebar montre l'état en cours. */
  readonly openAgent = computed(() => this.agents().find((a) => a.id === this.openAgentId()) ?? null);

  showAgent(id: string | null): void {
    this.openAgentId.set(id);
  }

  /** Panneau des agents repliable : le terminal prend alors toute la largeur. */
  readonly agentsOpen = signal(true);

  /** Filtre choisi (null = tous, undefined = pas encore choisi : filtre par défaut). */
  readonly agentFilter = signal<SessionState | null | undefined>(undefined);
  /** Un filtre par état présent, avec son compteur. */
  readonly agentFilters = computed(() => {
    const list = this.agents();
    return AGENT_FILTERS.map(({ states, ...f }) => ({ ...f, count: list.filter((a) => (states ?? [f.state]).includes(a.state)).length })).filter((f) => f.count);
  });
  /** Filtre appliqué : celui choisi s'il a encore des agents, sinon « Non terminés » s'il y en a, sinon « tous ». */
  readonly activeAgentFilter = computed(() => {
    const f = this.agentFilter();
    if (f === null) return null;
    const present = (st: SessionState) => this.agentFilters().some((x) => x.state === st);
    if (f && present(f)) return f;
    return present('running') ? 'running' : null;
  });
  /** Un agent qui attend reste visible quel que soit le filtre : c'est lui qui bloque la session. */
  readonly visibleAgents = computed(() => {
    const f = this.activeAgentFilter();
    const states = AGENT_FILTERS.find((x) => x.state === f)?.states ?? [f];
    return f ? this.agents().filter((a) => a.state === 'waiting' || states.includes(a.state)) : this.agents();
  });

  /** Recliquer sur le filtre actif le retire. */
  filterAgents(state: SessionState | null): void {
    this.agentFilter.set(state === this.activeAgentFilter() ? null : state);
  }

  toggleAgents(): void {
    this.agentsOpen.update((open) => !open);
  }

  connect(id: Signal<string>): void {
    this.source.set(id);
  }

  showView(view: SessionView): void {
    this.view.set(view);
  }

  readonly historyMode = signal<HistoryMode>('timeline');

  showHistory(mode: HistoryMode): void {
    this.historyMode.set(mode);
  }

  /** Recherche pré-remplie du journal (« Voir dans le journal » depuis la chronologie). */
  readonly logQuery = signal('');

  openLog(query: string): void {
    this.logQuery.set(query);
    this.historyMode.set('log');
    this.view.set('history');
  }

  /**
   * Version du compteur de fichiers modifiés (onglet Diff) : change à l'ouverture, à chaque fin de tour
   * (passage à « à toi » ou « terminé ») et en entrant / sortant de l'onglet Diff ; jamais à chaque événement, git status coûte.
   */
  private readonly diffVersion = counter(
    () => ({ state: this.summary()?.state, onDiff: this.view() === 'diff' }),
    (s, prev) => (!!prev.state && s.state !== prev.state && (s.state === 'turn' || s.state === 'done')) || s.onDiff !== prev.onDiff,
  );
  /** Pas de Diff pour une discussion : pas de git status. */
  private readonly gitId = computed(() => (this.summary() && !this.isChat() ? this.id() : null));
  private readonly git = this.vigie.gitResource(this.gitId, this.diffVersion);
  /** Nombre de fichiers modifiés ; garde le dernier chiffre pendant un rechargement (pas de clignotement). */
  private readonly lastGit = keepLast(this.git, this.gitId);
  readonly diffCount = computed(() => this.lastGit()?.files.length ?? 0);

  /**
   * Tâches mise : chargées à l'ouverture de la page (pour savoir si l'onglet existe), à chaque entrée dans l'onglet
   * (retour après `mise trust`) et sur « Rafraîchir » ; jamais à chaque snapshot. Pas de terminal ici (externe, discussion) : pas de tâches.
   */
  private readonly miseId = computed(() => (this.summary() && !this.isChat() && !this.isExternal() ? this.id() : null));
  private readonly miseVersion = counter(() => this.view() === 'mise', entering);
  private readonly miseResource = this.vigie.miseResource(this.miseId, this.miseVersion);
  /** Garde la dernière liste de la même session pendant un rechargement : l'onglet ne clignote pas. */
  readonly mise = keepLast(this.miseResource, this.miseId);
  readonly miseLoading = computed(() => this.miseResource.isLoading());
  /** L'onglet n'apparaît que si le projet embarque mise. */
  readonly hasMise = computed(() => hasMise(this.mise()));
  readonly miseCount = computed(() => projectTasks(this.mise()).length);

  reloadMise(): void {
    this.miseResource.reload();
  }

  /**
   * Projet Xcode (même session que mise : il faut un terminal) : chargé avec la page pour savoir si l'onglet existe,
   * relu à chaque entrée dans l'onglet (scripts ajoutés). Les schemes et simulateurs, lents, sont lus par l'onglet lui-même.
   */
  private readonly xcodeVersion = counter(() => this.view() === 'xcode', entering);
  private readonly xcodeResource = this.vigie.xcodeResource(this.miseId, this.xcodeVersion);
  readonly xcode = keepLast(this.xcodeResource, this.miseId);
  /** L'onglet n'apparaît que pour un projet iOS / Swift (workspace, projet ou Package.swift). */
  readonly hasXcode = computed(() => !!this.xcode()?.container);

  /** Redonne le focus au terminal, même déjà actif. */
  readonly focusTick = signal(0);

  /** « Aller au terminal » : ferme la sidebar d'agent et met le focus dans le terminal claude. */
  goToTerminal(): void {
    const t = this.claudeTerminal();
    if (!t) return;
    this.showAgent(null);
    this.selectTab(t.id);
    this.focusTick.update((n) => n + 1);
  }

  selectTab(id: string): void {
    this.activeTab.set(id);
    this.view.set('workspace');
  }

  async addShell(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const term = await this.vigie.openShell(id);
    this.activeTab.set(term.id);
  }

  /** Ferme un onglet shell ; s'il était affiché, on revient au terminal claude. */
  async closeTab(terminalId: string): Promise<void> {
    if (this.activeTab() === terminalId) this.activeTab.set(this.claudeTerminal()?.id ?? null);
    await this.vigie.closeTerminal(terminalId);
  }

  detach(terminalId: string): void {
    this.document.defaultView?.open(`/terminal/${terminalId}`, `vigie-${terminalId}`, 'width=1000,height=700');
  }

  readonly resuming = signal(false);
  readonly resumeError = signal<string | null>(null);

  /** Reprend la session externe ici : un terminal `claude --resume` apparaît, la vue passe en mode terminal. */
  async resume(): Promise<void> {
    const s = this.summary();
    if (!s || !(await this.confirm.resumeSession(s))) return;
    this.resuming.set(true);
    this.resumeError.set(null);
    try {
      await this.vigie.resumeSession(s);
      this.view.set('workspace');
    } catch (e) {
      this.resumeError.set((e as { error?: { error?: string } })?.error?.error ?? 'Reprise impossible.');
    } finally {
      this.resuming.set(false);
    }
  }

  async remove(): Promise<void> {
    // Discussion : quitter la page suffit, le garde de la route demande confirmation puis efface.
    if (this.isChat()) return void this.router.navigate(['/']);
    const s = this.summary();
    if (!s || !(await this.confirm.deleteSession({ title: s.title, terminalId: this.claudeTerminal()?.id ?? null }))) return;
    await this.vigie.deleteSession(s.id);
    await this.router.navigate(['/']);
  }

  /** Garde de sortie : quitter une discussion l'efface (après confirmation). Les autres sessions passent. */
  async leave(): Promise<boolean> {
    const id = this.id();
    if (!id || !this.isChat()) return true;
    if (!(await this.confirm.leaveChat())) return false;
    // ponytail: échec réseau ignoré, le daemon efface les discussions restantes à son prochain démarrage.
    await this.vigie.purgeChat(id).catch(() => undefined);
    return true;
  }

  /** Contexte de l'agent principal : utilisé / max, niveau d'alerte (≥ 60 % : à surveiller, ≥ 80 % : à compacter). */
  readonly context = computed(() => {
    const u = this.detail()?.usage;
    if (!u?.context) return null;
    const max = u.contextMax ?? 200_000;
    const pct = u.context / max;
    return { used: u.context, max, pct, level: pct >= 0.8 ? 'high' : pct >= 0.6 ? 'mid' : 'ok' };
  });
  /** /compact ne se tape que quand Claude attend ton message : sur une demande, Entrée validerait la demande. */
  /** Bloqué seulement sur une autorisation / question : là, l'Entrée validerait la réponse. Sinon Claude exécute ou met en file le /compact. */
  /** Claude ne travaille pas : fin de tour ou terminé, sans sous-agent actif (même règle que `store.idle` du daemon). */
  readonly idle = computed(() => {
    const s = this.summary();
    return !!s && (s.state === 'turn' || s.state === 'done') && s.activeSubagents === 0;
  });
  readonly canCompact = computed(() => !!this.claudeTerminal() && this.summary()?.state !== 'waiting');
  /** Échap n'a de sens que pendant une réponse de Claude. */
  readonly canInterrupt = computed(() => !!this.claudeTerminal() && this.summary()?.state === 'running');

  compact(): void {
    if (!this.canCompact()) return;
    this.send('/compact');
    // Entrée à part : envoyée d'un bloc, la TUI pourrait la prendre pour un collage (retour à la ligne, pas envoi).
    setTimeout(() => this.send('\r'), 150);
  }

  /** Demande à Claude de passer la session dans un worktree (outil natif EnterWorktree) : la conversation continue, seul le dossier change. Mêmes conditions que /compact. */
  enterWorktree(name: string): void {
    if (!this.canCompact()) return;
    this.send(`Utilise l'outil EnterWorktree pour continuer cette session dans un nouveau worktree${name ? ` nommé ${name}` : ''}, sans rien faire d'autre.`);
    setTimeout(() => this.send('\r'), 150);
  }

  /** Termine Claude Code proprement (/exit) : le transcript reste, la session pourra être reprise. Mêmes conditions que /compact. */
  async end(): Promise<void> {
    if (!this.canCompact() || !(await this.confirm.ask({
      title: 'Terminer la session ?',
      message: 'Claude Code quitte proprement (/exit). La conversation reste dans l’historique et pourra être reprise.',
      action: 'Terminer',
    }))) return;
    this.send('/exit');
    setTimeout(() => this.send('\r'), 150); // Entrée à part, comme pour /compact
  }

  allow(): Promise<void> { return this.send(KEYS.allow); }
  refuse(): Promise<void> { return this.send(KEYS.refuse); }
  interrupt(): Promise<void> { return this.send(KEYS.interrupt); }

  /** Échec du dernier envoi au terminal ; oublié quand la session change d'état (la demande a été traitée ailleurs) ou de page. */
  readonly replyError = linkedSignal<string, string | null>({ source: () => `${this.id()}|${this.summary()?.state}`, computation: () => null });

  private async send(keys: string): Promise<void> {
    const term = this.claudeTerminal();
    if (!term) return;
    this.replyError.set(null);
    this.selectTab(term.id);
    const error = await sendReply(this.vigie, term.id, keys);
    if (error) this.replyError.set(error);
  }
}
