import { DOCUMENT, DestroyRef, Injector, Service, Signal, inject, signal } from '@angular/core';
import { HttpClient, HttpResourceRef, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as C from '@vigie/contract';
import { FileBody, ProjectFiles, SearchResults, SessionCost, SessionLog, SessionSummary, Settings, SettingsBody, Snapshot, Terminal, TerminalBody, WriteBody } from './models';

/** Touches envoyées au PTY par les réponses rapides : le terminal reste la seule source d'interaction. */
/** Discussion sans projet : lancée par Vigie dans ~/.vigie/chat. */
// ponytail: reconnue par son dossier (même règle que CHAT_DIR du daemon) ; un drapeau dans le snapshot si ça diverge un jour.
export const isChat = (cwd: string | null | undefined): boolean => !!cwd?.endsWith('/.vigie/chat');

export const KEYS = { allow: '\r', refuse: '\x1b', interrupt: '\x1b' } as const;

/**
 * Réponse rapide (Autoriser, Refuser…) tapée dans le terminal d'une session.
 * Ne lève jamais : renvoie le message à afficher là où l'on a cliqué, ou null si la touche est partie.
 */
export async function sendReply(vigie: Pick<VigieService, 'sendKeys'>, terminalId: string, keys: string): Promise<string | null> {
  try {
    await vigie.sendKeys(terminalId, keys);
    return null;
  } catch (e) {
    const err = e as { status?: number; error?: { error?: string }; message?: string } | null;
    const reason = err?.error?.error ?? (err?.status === 0 ? 'le daemon ne répond pas' : err?.message || 'erreur inconnue');
    return `Impossible d'envoyer la réponse au terminal : ${reason}. Réessaie.`;
  }
}

/**
 * Accès au daemon. L'état global arrive en continu par WebSocket et ressort en signal ;
 * le reste passe par HTTP.
 */
/** Silence au-delà duquel la connexion d'état est tenue pour morte. */
const STALE_MS = 40_000;
/** Écart entre deux tours du chien de garde (5 s attendues) qui trahit une mise en veille. */
const WAKE_GAP_MS = 20_000;

/** Réponse hors contrat : message lisible plutôt que le détail zod (affiché tel quel par certains écrans). */
export const OUTDATED = 'Réponse inattendue du daemon : est-il à jour ? (redémarre-le après une mise à jour)';

/** Valide une réponse du daemon contre un schéma du contrat ; lève une erreur lisible si elle n'y correspond pas. */
const check = <T>(schema: { parse(v: unknown): T }) => (v: unknown): T => {
  try { return schema.parse(v); } catch { throw new Error(OUTDATED); }
};

@Service()
export class VigieService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private settingsRef: HttpResourceRef<Settings | undefined> | null = null;
  private readonly snapshotState = signal<Snapshot | null>(null);
  private readonly connectedState = signal(false);
  private readonly incompatibleState = signal(false);
  private socket: WebSocket | null = null;
  private closed = false;
  private lastMessage = 0;
  private lastTick = Date.now();

  /** Incrémenté à chaque sortie de veille : les terminaux s'en servent pour se rattacher. */
  readonly wakes = signal(0);

  readonly snapshot = this.snapshotState.asReadonly();
  readonly connected = this.connectedState.asReadonly();
  /** Le dernier snapshot reçu ne respecte pas le contrat : daemon d'une autre version. L'état affiché est le dernier valide. */
  readonly incompatible = this.incompatibleState.asReadonly();

  constructor() {
    // Au réveil, la connexion peut rester « ouverte » sans plus rien recevoir : l'UI se fige.
    // Toutes les 5 s : un saut d'horloge = sortie de veille ; un silence > STALE_MS = connexion morte (le daemon pousse au moins toutes les 15 s).
    const timer = setInterval(() => this.watchdog(), 5000);
    const onVisible = () => { if (this.document.visibilityState === 'visible') this.watchdog(); };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      this.closed = true;
      clearInterval(timer);
      this.document.removeEventListener('visibilitychange', onVisible);
      this.socket?.close();
    });
    this.open();
  }

  /** Détail d'une session, rechargé à chaque nouvel état poussé par le daemon. */
  sessionResource(id: Signal<string | null>) {
    return httpResource(() => {
      const sessionId = id();
      this.snapshot(); // dépendance : recharge quand le daemon signale un changement
      return sessionId ? `/api/sessions/${sessionId}` : undefined;
    }, { parse: check(C.SessionDetail) });
  }

  /** Lignes de consommation des `days` derniers jours (1 à 400) et fenêtres de 5 h closes ; rechargées au plus une fois par minute (le snapshot bouge à chaque événement). */
  usageResource(days: Signal<number>) {
    return httpResource(() => `/api/usage?days=${days()}&m=${Math.floor((this.snapshot()?.now ?? 0) / 60_000)}`, { parse: check(C.UsageRows) });
  }

  /** Coût d'une session au fil du temps, par agent (non cumulé). */
  sessionCost(sessionId: string): Promise<SessionCost> {
    return firstValueFrom(this.http.get(`/api/sessions/${sessionId}/cost`)).then(check(C.SessionCost));
  }

  /**
   * Projets : récents si `q` n'a pas de '/', sinon sous-dossiers du chemin tapé qui commencent par son dernier segment.
   * `q` undefined : aucune requête.
   */
  projectsResource(q: () => string | undefined = () => '') {
    return httpResource(() => {
      const v = q();
      return v === undefined ? undefined : { url: '/api/projects', params: { q: v } };
    }, { defaultValue: [], parse: check(C.Projects) });
  }

  /** Réglages du daemon (locale des terminaux, seuils d'alerte) : une seule ressource partagée, mise à jour par saveSettings. */
  settingsResource(): HttpResourceRef<Settings | undefined> {
    return (this.settingsRef ??= httpResource(() => '/api/settings', { parse: check(C.Settings), injector: this.injector }));
  }

  /** Enregistre les champs fournis seulement (`locale` null : locale automatique ; `alerts` : seuils, null = désactivé). */
  saveSettings(body: SettingsBody): Promise<Settings> {
    return firstValueFrom(this.http.post('/api/settings', body)).then(check(C.Settings)).then((s) => {
      this.settingsResource().set(s);
      return s;
    });
  }

  startSession(body: { cwd: string; command: string }): Promise<Terminal> {
    return firstValueFrom(this.http.post('/api/sessions', body)).then(check(C.Terminal));
  }

  /** Discussion sans projet : Claude en mode plan dans un dossier vide (~/.vigie/chat). */
  startChat(): Promise<Terminal> {
    return firstValueFrom(this.http.post('/api/chat', {})).then(check(C.Terminal));
  }

  /** Trace découpée en tours ; `version` (dernière activité) déclenche le rechargement. */
  traceResource(sessionId: Signal<string | null>, version: Signal<number>) {
    return httpResource(() => (sessionId() ? `/api/sessions/${sessionId()}/trace?v=${version()}` : undefined), { parse: check(C.SessionTrace) });
  }

  /** Configuration Claude Code du dossier de la session, avec les vérifications du daemon. */
  configResource(sessionId: Signal<string | null>) {
    return httpResource(() => (sessionId() ? `/api/sessions/${sessionId()}/config` : undefined), { parse: check(C.ClaudeConfig) });
  }

  /** Fichiers modifiés dans le dépôt de la session, avec leur patch ; `version` (dernière activité) déclenche le rechargement. */
  gitResource(sessionId: Signal<string | null>, version: Signal<number>) {
    return httpResource(() => (sessionId() ? `/api/sessions/${sessionId()}/git?v=${version()}` : undefined), { parse: check(C.GitDiff) });
  }

  /** Journal d'une session ; `since` : seulement les lignes à partir de cette date (rafraîchissement incrémental). */
  sessionLog(sessionId: string, since = 0): Promise<SessionLog> {
    return firstValueFrom(this.http.get(`/api/sessions/${sessionId}/log`, { params: { since } })).then(check(C.SessionLog));
  }

  /** Reprend dans Vigie une session lancée ailleurs : même transcript, même id (le daemon reconnaît --resume <id>). */
  resumeSession(s: Pick<SessionSummary, 'id' | 'cwd'>): Promise<Terminal> {
    return this.startSession({ cwd: s.cwd, command: `claude --resume ${s.id}` });
  }

  /** Nouveau terminal dans le dossier de la session : shell nu, tâche mise (`miseTask`), `mise trust` (`miseTrust`), action Xcode (`xcode`) ou script du projet (`script`). 400 si la tâche est inconnue. */
  openShell(sessionId: string, body: TerminalBody = {}): Promise<Terminal> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/terminals`, body)).then(check(C.Terminal));
  }

  /** Tâches mise du dossier de la session ; `version` déclenche le rechargement (jamais à chaque snapshot : mise tasks coûte). */
  miseResource(sessionId: Signal<string | null>, version: Signal<number>) {
    return httpResource(() => (sessionId() ? `/api/sessions/${sessionId()}/mise?v=${version()}` : undefined), { parse: check(C.MiseTasks) });
  }

  /** Projet Xcode du dossier (rapide, sans process) : `container` null = pas d'onglet Xcode. */
  xcodeResource(sessionId: Signal<string | null>, version: Signal<number>) {
    return httpResource(() => (sessionId() ? `/api/sessions/${sessionId()}/xcode?v=${version()}` : undefined), { parse: check(C.XcodeProject) });
  }

  /** Schemes et simulateurs (lent, jusqu'à 30 s : xcodebuild + simctl) ; chargé à l'entrée dans l'onglet, rechargé par `reload()`. */
  xcodeTargetsResource(sessionId: Signal<string | null>) {
    return httpResource(() => (sessionId() ? `/api/sessions/${sessionId()}/xcode/targets` : undefined), { parse: check(C.XcodeTargets) });
  }

  /** Ouvre le projet dans Xcode (`open` côté daemon). */
  openXcode(sessionId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/xcode/open`, {}));
  }

  /** Tue le process du terminal et retire son onglet. */
  closeTerminal(terminalId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/terminals/${terminalId}/close`, {}));
  }

  /** Ferme les terminaux de la session et la retire de Vigie (le transcript de Claude est conservé). */
  /** Discussion : terminal fermé et transcript effacé du disque (le daemon refuse toute autre session). */
  purgeChat(sessionId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/chat/${sessionId}/delete`, {}));
  }

  deleteSession(sessionId: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/delete`, {}));
  }

  /** Annule les modifications d'un fichier (retour à HEAD ; un fichier non suivi est supprimé). */
  restoreFile(sessionId: string, path: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/git/restore`, { path }));
  }

  /** Contenu actuel d'un fichier modifié, avec son empreinte (à renvoyer à l'écriture). */
  gitFile(sessionId: string, path: string): Promise<FileBody> {
    return firstValueFrom(this.http.get(`/api/sessions/${sessionId}/git/file`, { params: { path } })).then(check(C.FileBody));
  }

  /** Écrit le fichier ; le daemon refuse (409) si Claude travaille ou si le fichier a changé depuis la lecture (`hash`). */
  writeFile(sessionId: string, body: WriteBody): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/git/write`, body));
  }

  /** Arbre du projet de la session (liste plate, dossiers ignorés repliés) ; pas de cache côté daemon, rappeler pour rafraîchir. */
  files(sessionId: string): Promise<ProjectFiles> {
    return firstValueFrom(this.http.get(`/api/sessions/${sessionId}/files`)).then(check(C.ProjectFiles));
  }

  /** Contenu de n'importe quel fichier texte du projet (ignorés compris), avec son empreinte (à renvoyer à l'écriture). */
  readProjectFile(sessionId: string, path: string): Promise<FileBody> {
    return firstValueFrom(this.http.get(`/api/sessions/${sessionId}/files/read`, { params: { path } })).then(check(C.FileBody));
  }

  /**
   * Recherche texte littérale dans les fichiers du projet (insensible à la casse sauf `matchCase`).
   * `signal` annulé : la requête HTTP est coupée (le daemon arrête alors sa recherche) et la promesse rejetée.
   */
  searchFiles(sessionId: string, q: string, matchCase: boolean, signal?: AbortSignal): Promise<SearchResults> {
    const params: Record<string, string> = matchCase ? { q, case: '1' } : { q };
    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const sub = this.http.get(`/api/sessions/${sessionId}/files/search`, { params }).subscribe({ next: resolve, error: reject });
      signal?.addEventListener('abort', () => { sub.unsubscribe(); reject(signal.reason); }, { once: true });
    }).then(check(C.SearchResults));
  }

  /** Écrit un fichier du projet ; refus si Claude travaille (409), si le fichier a changé (412) ou sous ~/.claude (403). */
  writeProjectFile(sessionId: string, body: WriteBody): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/files/write`, body));
  }

  /** `git add -A` puis `git commit -m message` dans le dépôt de la session. */
  commit(sessionId: string, message: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/git/commit`, { message }));
  }

  suggestCommitMessage(sessionId: string): Promise<{ message: string }> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/git/commit-message`, {})).then(check(C.CommitSuggestion));
  }

  /** `git switch -c name` dans le dépôt de la session : les modifs non commitées suivent. */
  createBranch(sessionId: string, name: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/sessions/${sessionId}/git/branch`, { name }));
  }

  sendKeys(terminalId: string, data: string): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/terminals/${terminalId}/input`, { data }));
  }

  terminalSocket(terminalId: string): WebSocket {
    return new WebSocket(this.wsUrl(`/pty/${terminalId}`));
  }

  private wsUrl(path: string): string {
    const { protocol, host } = this.document.location;
    return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}${path}`;
  }

  private watchdog(): void {
    const now = Date.now();
    const slept = now - this.lastTick > WAKE_GAP_MS;
    this.lastTick = now;
    if (slept) this.wakes.update((n) => n + 1);
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return; // déjà en train de se reconnecter
    if (slept || now - this.lastMessage > STALE_MS) this.reopen();
  }

  /** Remplace la connexion sans attendre sa fermeture (qui peut ne jamais arriver). */
  private reopen(): void {
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.connectedState.set(false);
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.wsUrl('/ws'));
    this.socket = ws;
    this.lastMessage = Date.now();
    ws.onopen = () => this.connectedState.set(true);
    ws.onmessage = (e) => {
      this.lastMessage = Date.now();
      let msg: { type?: unknown };
      try { msg = JSON.parse(e.data); } catch { return; } // trame illisible : on attend la suivante
      if (msg?.type !== 'snapshot') return;
      const { type: _, ...snapshot } = msg;
      const parsed = C.Snapshot.safeParse(snapshot);
      // Hors contrat : on garde le dernier état valide et on le signale (bandeau du shell).
      this.incompatibleState.set(!parsed.success);
      if (parsed.success) this.snapshotState.set(parsed.data);
    };
    ws.onclose = () => {
      if (this.socket !== ws) return; // connexion déjà remplacée
      this.connectedState.set(false);
      if (!this.closed) setTimeout(() => this.open(), 1000);
    };
  }
}
