import { DOCUMENT, Injectable, Signal, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AttentionService, KEYS } from '../../../core/attention.service';
import { ConfirmService } from '../../../core/confirm.service';
import { DISCARD_EDIT } from '../diff/session-diff.vm';
import { SessionDetail, SessionState } from '../../../core/models';
import { OUTDATED, VigieService, daemonError, isChat } from '../../../core/vigie.service';
import { stateLabel } from '../../../core/session-view';
import { counter, keepLast } from '../../../core/signals';
import { CLIENT_OS, isShortcut } from '../../../core/platform';

/**
 * Filtres de la liste des agents, dans l'ordre d'urgence. « Non terminés » regroupe ceux qui t'attendent (question,
 * autorisation, fin de tour) et ceux qui tournent ; pas de puce « À toi » ni « En cours » à part : la rangée tient sur une ligne.
 */
const AGENT_FILTERS: { state: SessionState; label: string; states?: SessionState[] }[] = [
  { state: 'waiting', label: 'En attente' },
  { state: 'running', label: 'Non terminés', states: ['waiting', 'running', 'turn'] },
  { state: 'done', label: 'Terminés' },
];

/** Vue de la page de session ; `plugin:<id>` : onglet d'un plugin actif qui s'applique au projet (décision 034). */
export type SessionTab = 'workspace' | 'diff' | 'files' | 'history' | 'usage' | 'config' | `plugin:${string}`;
/** Onglet Historique : la chronologie par tours ou le journal brut. */
export type HistoryMode = 'timeline' | 'log';
/** Saisie non enregistrée des onglets qui éditent des fichiers, lue par la page sur leurs composants. */
export interface Drafts { diff: Signal<boolean>; files: Signal<boolean> }

/**
 * Dernière vue choisie : survit au changement de session (même si la page est recréée en passant par la liste).
 * ponytail: mémoire du module, perdue au rechargement ; localStorage si on veut la garder entre deux lancements.
 */
let lastView: SessionTab = 'workspace';

@Injectable()
export class SessionPageVm {
  private readonly vigie = inject(VigieService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly attention = inject(AttentionService);
  private readonly source = signal<Signal<string> | null>(null);
  private readonly drafts = signal<Drafts | null>(null);

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
  readonly waitBar = computed(() => {
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
    if (!d) return null;
    const u = d.usage;
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

  /**
   * Onglet de premier niveau : terminal et agents, chronologie, consommation… en pleine page. Une discussion n'a que Discussion
   * et Consommation : on y arrive sur Discussion, puis la vue choisie reste (la source bouge aussi avec les onglets de plugins).
   * Ailleurs, on garde la dernière vue choisie, sauf un onglet de plugin qui disparaît (plugin désactivé, projet qui ne s'y prête
   * plus) : retour au terminal.
   */
  readonly view = linkedSignal<{ chat: boolean; tabs: string[] | null }, SessionTab>({
    source: () => ({ chat: this.isChat(), tabs: this.pluginsResource.isLoading() ? null : this.plugins().map((p) => `plugin:${p.id}`) }),
    computation: ({ chat, tabs }, prev) => {
      if (chat) return prev?.source.chat ? prev.value : 'workspace';
      const view = prev && !prev.source.chat ? prev.value : lastView;
      return view.startsWith('plugin:') && tabs && !tabs.includes(view) ? 'workspace' : view;
    },
  });
  /**
   * Règle de défilement du gabarit (shell/page) : `fill` pour les vues en colonnes qui défilent chacune (terminal et agents, Diff,
   * Fichiers, Historique, Config, plugins) ; `scroll` pour celles qui se lisent d'un trait (Consommation, agents d'une session externe).
   */
  readonly pageMode = computed(() => {
    const view = this.view();
    return view === 'usage' || (view === 'workspace' && this.isExternal()) ? ('scroll' as const) : ('fill' as const);
  });
  private readonly rememberView = effect(() => {
    const view = this.view();
    // Un onglet de plugin n'est pas retenu : la session suivante ne l'a peut-être pas.
    if (!this.isChat() && !view.startsWith('plugin:')) lastView = view;
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

  /** `drafts` : saisie non enregistrée des onglets Diff et Fichiers (absente d'une page sans onglet d'édition, specs comprises). */
  connect(id: Signal<string>, drafts?: Drafts): void {
    this.source.set(id);
    this.drafts.set(drafts ?? null);
  }

  /** Diff : l'onglet reste monté tant qu'une saisie y existe, on peut changer de vue sans la perdre. */
  readonly diffUnsaved = computed(() => this.drafts()?.diff() ?? false);
  /** Fichiers : la vue n'est montée qu'affichée, la quitter perdrait les brouillons de ses onglets. */
  private readonly filesUnsaved = computed(() => this.drafts()?.files() ?? false);
  private readonly unsaved = computed(() => this.diffUnsaved() || this.filesUnsaved());

  /** Une saisie non enregistrée (Diff, Fichiers) demande confirmation avant d'être perdue ; true = on peut continuer. */
  private async discardDrafts(): Promise<boolean> {
    return !this.unsaved() || this.confirm.ask(DISCARD_EDIT);
  }

  /**
   * Rechargement, fermeture de la fenêtre ou de l'onglet : une saisie non enregistrée fait demander au navigateur (ou à
   * Electron) de confirmer. Le texte du dialogue est celui du navigateur.
   */
  beforeUnload(e: BeforeUnloadEvent): void {
    if (!this.unsaved()) return;
    e.preventDefault();
    e.returnValue = ''; // navigateurs qui ignorent encore preventDefault ici
  }

  /** Seul changement de vue : quitter Fichiers avec une saisie non enregistrée demande confirmation. false = on reste. */
  async showView(view: SessionTab): Promise<boolean> {
    const current = this.view();
    if (view !== current && current === 'files' && this.filesUnsaved() && !(await this.confirm.ask(DISCARD_EDIT))) return false;
    this.view.set(view);
    return true;
  }

  private readonly mac = inject(CLIENT_OS) === 'mac';
  /** Raccourci de la vue Fichiers, selon la plateforme du client (libellé et aria-keyshortcuts). */
  readonly filesKey = this.mac ? { label: '⌘⇧E', aria: 'Meta+Shift+E' } : { label: 'Ctrl+Shift+E', aria: 'Control+Shift+E' };
  /** Bouton Fichiers : absent pour une discussion (pas de projet). */
  readonly canFiles = computed(() => !!this.summary() && !this.isChat());
  /** Vue quittée en entrant dans Fichiers, rendue en ressortant. */
  private beforeFiles: SessionTab = 'workspace';

  /** Bouton Fichiers (ou ⌘⇧E) : la vue Fichiers occupe la page sous l'en-tête ; recliquer rend la vue précédente. */
  async toggleFiles(): Promise<void> {
    if (this.view() === 'files') {
      await this.showView(this.beforeFiles);
      return;
    }
    this.beforeFiles = this.view();
    await this.showView('files');
  }

  /**
   * Raccourcis de la page : ⌘⇧E / Ctrl+Shift+E bascule la vue Fichiers. Libre dans l'app (⌘N, ⌘B, ⌘F, ⌘P, ⌘⇧F, ⌘S sont pris ailleurs),
   * dans Electron (menu par défaut) et Chrome ; c'est celui de l'explorateur de VS Code.
   */
  shortcut(e: KeyboardEvent): void {
    if (!this.canFiles() || !isShortcut(e, 'e', this.mac, true)) return;
    e.preventDefault();
    void this.toggleFiles();
  }

  readonly historyMode = signal<HistoryMode>('timeline');

  showHistory(mode: HistoryMode): void {
    this.historyMode.set(mode);
  }

  /** Recherche pré-remplie du journal (« Voir dans le journal » depuis la chronologie). */
  readonly logQuery = signal('');

  async openLog(query: string): Promise<void> {
    if (!(await this.showView('history'))) return;
    this.logQuery.set(query);
    this.historyMode.set('log');
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
   * Onglets des plugins : plugins actifs dont la détection vaut pour ce dossier. Relus quand la liste des plugins actifs change
   * (page Plugins), jamais à chaque événement. Session externe comprise : le daemon résout le dossier par le store et une action
   * ouvre son propre terminal dans la session (qui cesse alors d'être externe). Discussion (pas de projet) : pas d'onglet, pas de requête.
   */
  private readonly pluginsId = computed(() => (this.summary()?.cwd && !this.isChat() ? this.id() : null));
  private readonly pluginsResource = this.vigie.sessionPluginsResource(this.pluginsId);
  /** Garde la dernière liste de la même session pendant un rechargement : les onglets ne clignotent pas. */
  private readonly lastPlugins = keepLast(this.pluginsResource, this.pluginsId);
  readonly plugins = computed(() => (this.pluginsId() && this.vigie.snapshot()?.plugins.length ? this.lastPlugins() ?? [] : []));
  /** Relit les onglets de plugins (un plugin le demande, ex. après `mise trust`). */
  reloadTabs(): void {
    this.pluginsResource.reload();
  }

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
    void this.showView('workspace');
  }

  async addShell(): Promise<void> {
    const id = this.id();
    if (!id) return;
    this.actionError.set(null);
    try {
      const term = await this.vigie.openShell(id);
      this.activeTab.set(term.id);
    } catch (e) {
      this.actionError.set(daemonError(e, 'Ouverture du shell impossible.'));
    }
  }

  /** Ferme un onglet shell ; s'il était affiché, on revient au terminal claude. */
  async closeTab(terminalId: string): Promise<void> {
    if (this.activeTab() === terminalId) this.activeTab.set(this.claudeTerminal()?.id ?? null);
    this.actionError.set(null);
    try {
      await this.vigie.closeTerminal(terminalId);
    } catch (e) {
      this.actionError.set(daemonError(e, 'Fermeture du terminal impossible.'));
    }
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
      await this.showView('workspace');
    } catch (e) {
      this.resumeError.set(daemonError(e, 'Reprise impossible.'));
    } finally {
      this.resuming.set(false);
    }
  }

  /** Session supprimée : les brouillons ont déjà été abandonnés, le garde de sortie ne redemande pas. */
  private removed = false;

  /**
   * Supprime la session puis revient au Dashboard. Les brouillons sont abandonnés avant la confirmation de suppression : un refus
   * plus tard (au garde de la route) laisserait sur une session déjà supprimée.
   */
  async remove(): Promise<void> {
    // Discussion : quitter la page suffit, le garde de la route demande confirmation puis efface.
    if (this.isChat()) return void this.router.navigate(['/']);
    const s = this.summary();
    if (!s || !(await this.discardDrafts())) return;
    if (!(await this.confirm.deleteSession({ title: s.title, terminalId: this.claudeTerminal()?.id ?? null }))) return;
    this.actionError.set(null);
    try {
      await this.vigie.deleteSession(s.id);
    } catch (e) {
      this.actionError.set(daemonError(e, 'Suppression impossible.'));
      return;
    }
    this.removed = true;
    await this.router.navigate(['/']);
  }

  /** Garde de sortie : une saisie non enregistrée (Diff, Fichiers) demande confirmation ; quitter une discussion l'efface (après confirmation). */
  async leave(): Promise<boolean> {
    if (!this.removed && !(await this.discardDrafts())) return false;
    const id = this.id();
    if (!id || !this.isChat()) return true;
    if (!(await this.confirm.leaveChat())) return false;
    try {
      await this.vigie.purgeChat(id);
    } catch {
      // On reste sur la page : partir maintenant ferait croire la discussion effacée alors qu'elle est encore sur le disque.
      // ponytail: pas d'échappatoire si le daemon reste injoignable (la navigation est bloquée) ; le daemon efface les discussions au démarrage.
      this.actionError.set('La discussion n’a pas pu être supprimée : le daemon répond-il ? Réessaie de quitter.');
      return false;
    }
    return true;
  }

  /** Contexte de l'agent principal : utilisé / max, niveau d'alerte (≥ 60 % : à surveiller, ≥ 80 % : à compacter). */
  readonly context = computed(() => {
    const u = this.detail()?.usage;
    if (!u?.context) return null;
    const max = u.contextMax;
    const pct = u.context / max;
    return { used: u.context, max, pct, level: pct >= 0.8 ? 'high' : pct >= 0.6 ? 'mid' : 'ok' };
  });
  /** Claude ne travaille pas : fin de tour ou terminé, sans sous-agent actif (même règle que `store.idle` du daemon). */
  readonly idle = computed(() => {
    const s = this.summary();
    return !!s && (s.state === 'turn' || s.state === 'done') && s.activeSubagents === 0;
  });
  /** /compact bloqué seulement sur une autorisation / question : là, l'Entrée validerait la réponse. Sinon Claude exécute ou met en file le /compact. */
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

  /**
   * Dernière action de la page en échec (shell ouvert ou fermé, suppression, discussion qui n'a pas pu être effacée en partant) ;
   * effacé au nouvel essai, oublié quand la session change d'état ou de page.
   */
  private readonly actionError = linkedSignal<string, string | null>({ source: () => `${this.id()}|${this.summary()?.state}`, computation: () => null });
  /** Échec à afficher sous l'en-tête : dernier envoi au terminal de cette session (AttentionService), ou action de la page. */
  readonly replyError = computed(() => {
    const e = this.attention.replyError();
    return this.actionError() ?? (e && e.id === this.id() ? e.message : null);
  });

  private async send(keys: string): Promise<void> {
    const id = this.id(), term = this.claudeTerminal();
    if (!id || !term) return;
    // Le terminal s'affiche pour qu'on voie la suite, sauf par-dessus une saisie non enregistrée de Fichiers (la touche part quand même).
    if (!this.filesUnsaved()) this.selectTab(term.id);
    await this.attention.send(id, term.id, keys);
  }
}
