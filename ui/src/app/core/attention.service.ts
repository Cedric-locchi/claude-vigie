import { DOCUMENT, DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { AttentionEntry, AttentionKind, Prefs, TurnPref, UsageAlert, bell, deliver, groupLog, parseLog, pendingSessions, usageAlerts, when } from './attention';
import { Alerts, SessionState, SessionSummary, Usage } from './models';
import { readPref, writePref } from './prefs';
import { SessionView } from './session-view';
import { VigieService, daemonError } from './vigie.service';

/** Touches envoyées au PTY par les réponses rapides : le terminal reste la seule source d'interaction. */
export const KEYS = { allow: '\r', refuse: '\x1b', interrupt: '\x1b' } as const;

/** Notification système des attentes (clé historique : coupait tout avant les réglages par type). */
const NOTIFY_KEY = 'vigie-notify';
const TURN_KEY = 'vigie-notify-turn';
const USAGE_KEY = 'vigie-notify-usage';
const SOUND_KEY = 'vigie-sound';
const PAUSE_KEY = 'vigie-pause-until';
const LOG_KEY = 'vigie-attention-log';
/** Dernière alerte envoyée : jour local (coût) et fin de fenêtre (5 h) ; gardées pour ne pas répéter au rechargement. */
const COST_ALERT_KEY = 'vigie-alert-cost-day';
const WINDOW_ALERT_KEY = 'vigie-alert-window-end';
/** Alertes ignorées depuis le panneau (même forme : jour, fin de fenêtre). */
const COST_DISMISS_KEY = 'vigie-dismiss-cost';
const WINDOW_DISMISS_KEY = 'vigie-dismiss-window';
/** Au-delà, une seule notification résume le lot (ex. réveil après une longue pause). */
const MAX_NOTIFICATIONS = 3;
const MAX_LOG = 50;
const MAX_TOASTS = 3;
/** Un toast de fin de tour se ferme seul ; une attente reste jusqu'à ce qu'elle change. */
const TOAST_MS = 6000;
const PAUSE_MS = 3_600_000;

/** Toast dans l'app : une session, dont le contenu est relu en direct dans `pending`. */
export interface Toast { id: number; kind: 'waiting' | 'turn'; sessionId: string }

const needsYou = (state: SessionState) => state === 'waiting' || state === 'turn';
const logKind = (s: SessionSummary): AttentionKind => (s.state === 'turn' ? 'turn' : (s.reason ?? 'permission'));

/**
 * Tout ce qui demande ton attention : ce qui est à traiter (dérivé du snapshot, jamais d'un journal),
 * le journal « Plus tôt », et la façon de prévenir (toast si Vigie a le focus, sinon notification système, son).
 * Pas de rafale au démarrage, rien pour la session déjà affichée dans la fenêtre active.
 */
@Service()
export class AttentionService {
  private readonly vigie = inject(VigieService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly win = this.document.defaultView;

  readonly systemWaiting = signal(readPref(NOTIFY_KEY) !== 'off');
  readonly turn = signal<TurnPref>(this.loadTurn());
  readonly usage = signal(readPref(USAGE_KEY) !== 'off');
  readonly sound = signal(readPref(SOUND_KEY) !== 'off');
  /** Autorisation du système / navigateur : « denied » = rien ne s'affichera, il faut le dire. */
  readonly permission = signal<NotificationPermission | 'unsupported'>(this.currentPermission());
  /** Un réglage demande la notification système (l'explication d'un refus n'a de sens que dans ce cas). */
  readonly wantsSystem = computed(() => this.systemWaiting() || this.turn() === 'system' || this.usage());

  private readonly pauseUntil = signal(Number(readPref(PAUSE_KEY)) || 0);
  private readonly now = computed(() => this.vigie.snapshot()?.now ?? Date.now());
  /** Fin de la pause en cours (ni son ni notification système), ou null. */
  readonly pausedUntil = computed(() => (this.pauseUntil() > this.now() ? this.pauseUntil() : null));

  /** Seuils d'alerte de consommation (Réglages) ; null tant que le daemon ne les a pas donnés. */
  private readonly settings = this.vigie.settingsResource();
  readonly alerts = computed<Alerts | null>(() => (this.settings.hasValue() ? this.settings.value().alerts : null));
  private readonly dismissed = signal({ cost: readPref(COST_DISMISS_KEY), window: readPref(WINDOW_DISMISS_KEY) });

  /** À traiter : sessions qui attendent, fins de tour, puis alertes de conso actives. Chaque entrée disparaît quand l'état change. */
  readonly pending = computed(() => pendingSessions(this.vigie.snapshot()?.sessions ?? [], this.now()));
  readonly usageAlerts = computed(() => {
    const snap = this.vigie.snapshot();
    return snap ? usageAlerts(snap.usage, snap.now, this.alerts(), this.dismissed()) : [];
  });
  readonly bell = computed(() => bell(this.vigie.snapshot()?.sessions ?? [], this.usageAlerts().length, this.pausedUntil()));

  /** Journal « Plus tôt » : attentes et fins de tour terminées, mémorisées sur cette machine. */
  private readonly log = signal<AttentionEntry[]>(parseLog(readPref(LOG_KEY)));
  readonly history = computed(() => groupLog(this.log()).map((g) => ({ ...g, when: g.times.slice(0, 3).map((ts) => when(ts, this.now())).join(' · ') })));

  private readonly toastList = signal<Toast[]>([]);
  /** Toasts affichés ; ceux d'une session disparaissent dès qu'elle quitte l'état annoncé. */
  readonly toasts = computed(() => this.toastList().flatMap((t): (Toast & { row: SessionView })[] => {
    const row = this.pending().find((r) => r.s.id === t.sessionId && r.s.state === t.kind);
    return row ? [{ ...t, row }] : [];
  }));
  private nextId = 1;

  /**
   * Échec du dernier envoi au terminal d'une session, affiché là où elle apparaît (ligne, toast, cloche, page de la session) ;
   * oublié quand elle change d'état (la demande a été traitée ailleurs).
   */
  readonly replyError = signal<{ id: string; message: string } | null>(null);

  /** État précédent de chaque session ; null tant que le premier snapshot n'est pas arrivé. */
  private previous: Map<string, { state: SessionState; kind: AttentionKind; title: string; since: number }> | null = null;
  private audio: AudioContext | null = null;

  constructor() {
    effect(() => {
      const snap = this.vigie.snapshot();
      if (snap) untracked(() => this.check(snap.sessions));
    });
    effect(() => {
      const snap = this.vigie.snapshot();
      const alerts = this.alerts();
      if (snap && alerts) untracked(() => this.checkUsage(snap.usage, snap.now, alerts));
    });
    // Titre de la fenêtre : nombre de demandes en attente, visible dans le Dock / la barre d'onglets.
    effect(() => {
      const waiting = this.bell().waiting;
      this.document.title = waiting ? `(${waiting}) Vigie` : 'Vigie';
    });
    const destroy = inject(DestroyRef);
    // Ouvrir une session ferme ses toasts : elle est sous tes yeux.
    this.router.events.pipe(takeUntilDestroyed(destroy)).subscribe((e) => {
      const id = e instanceof NavigationEnd ? e.urlAfterRedirects.match(/^\/sessions\/([^/?#]+)/)?.[1] : null;
      if (id) this.toastList.update((list) => list.filter((t) => t.sessionId !== id));
    });
    // Un navigateur n'accorde la permission que sur un geste de l'utilisateur : on la demande au premier clic.
    const ask = () => { if (this.wantsSystem()) void this.askPermission(); };
    this.document.addEventListener('pointerdown', ask, { once: true });
    destroy.onDestroy(() => this.document.removeEventListener('pointerdown', ask));
  }

  /** Notification système des autorisations et questions (le toast et le panneau restent toujours actifs). */
  async setSystemWaiting(on: boolean): Promise<void> {
    this.systemWaiting.set(on);
    writePref(NOTIFY_KEY, on ? 'on' : 'off');
    if (on) await this.tryOut();
  }

  async setTurn(pref: TurnPref): Promise<void> {
    this.turn.set(pref);
    writePref(TURN_KEY, pref);
    if (pref === 'system') await this.tryOut();
  }

  setUsage(on: boolean): void {
    this.usage.set(on);
    writePref(USAGE_KEY, on ? 'on' : 'off');
  }

  setSound(on: boolean): void {
    this.sound.set(on);
    writePref(SOUND_KEY, on ? 'on' : 'off');
    if (on) this.chime('turn'); // aperçu, et débloque l'audio au passage
  }

  /** Ne pas déranger pendant 1 h : ni son ni notification système ; le panneau et les toasts continuent. */
  pause(): void {
    const until = Date.now() + PAUSE_MS;
    this.pauseUntil.set(until);
    writePref(PAUSE_KEY, String(until));
  }

  resume(): void {
    this.pauseUntil.set(0);
    writePref(PAUSE_KEY, '0');
  }

  dismiss({ key, dismissKey }: UsageAlert): void {
    this.dismissed.update((d) => ({ ...d, [key]: dismissKey }));
    writePref(key === 'cost' ? COST_DISMISS_KEY : WINDOW_DISMISS_KEY, dismissKey);
  }

  clearHistory(): void {
    this.log.set([]);
    writePref(LOG_KEY, '[]');
  }

  closeToast(id: number): void {
    this.toastList.update((list) => list.filter((t) => t.id !== id));
  }

  /** Autoriser / Refuser (cloche, toast, barre latérale, Dashboard) : la touche part dans le terminal claude de la session qui attend. */
  async reply(sessionId: string, answer: 'allow' | 'refuse'): Promise<void> {
    const s = this.vigie.snapshot()?.sessions.find((x) => x.id === sessionId);
    if (s?.terminalId && s.state === 'waiting') await this.send(s.id, s.terminalId, KEYS[answer]);
  }

  /** Tape `keys` dans un terminal de la session (seul envoi de touches de l'app) ; ne lève jamais : un échec va dans `replyError`. */
  async send(sessionId: string, terminalId: string, keys: string): Promise<boolean> {
    this.replyError.set(null);
    try {
      await this.vigie.sendKeys(terminalId, keys);
      return true;
    } catch (e) {
      this.replyError.set({ id: sessionId, message: `Impossible d'envoyer la réponse au terminal : ${daemonError(e, 'erreur inconnue', { inline: true })}. Réessaie.` });
      return false;
    }
  }

  private async tryOut(): Promise<void> {
    // Activer = demander l'autorisation si besoin, puis envoyer un essai : on voit tout de suite si ça marche.
    if ((await this.askPermission()) === 'granted') this.show('', 'Notifications Vigie activées', 'Tu seras prévenu quand une session a besoin de toi.');
  }

  private async askPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!this.win || !('Notification' in this.win)) return 'unsupported';
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* refus ou API indisponible */ }
    }
    this.permission.set(Notification.permission);
    return Notification.permission;
  }

  private currentPermission(): NotificationPermission | 'unsupported' {
    return this.win && 'Notification' in this.win ? Notification.permission : 'unsupported';
  }

  private prefs(): Prefs {
    return { systemWaiting: this.systemWaiting(), turn: this.turn(), usage: this.usage(), sound: this.sound() };
  }

  private context(sessionId: string) {
    const focused = this.document.hasFocus();
    const shown = focused && !!sessionId && this.router.url.match(/^\/sessions\/([^/?#]+)/)?.[1] === sessionId;
    return { focused, shown, paused: this.pauseUntil() > Date.now() };
  }

  private check(sessions: SessionSummary[]): void {
    const before = this.previous;
    const current = new Map(sessions.map((s) => {
      const p = before?.get(s.id);
      return [s.id, { state: s.state, kind: logKind(s), title: s.title, since: p?.state === s.state ? p.since : s.lastTs }];
    }));
    this.previous = current;
    if (!before) return; // premier snapshot : ce qui attend déjà n'est pas une nouveauté
    const err = this.replyError();
    if (err && before.get(err.id)?.state !== current.get(err.id)?.state) this.replyError.set(null);
    // Journal : une attente ou une fin de tour qui se termine (on note quand elle a commencé, pas comment elle s'est réglée).
    const ended = [...before].filter(([id, p]) => needsYou(p.state) && current.get(id)?.state !== p.state);
    if (ended.length) {
      this.log.update((list) => [...ended.map(([sessionId, p]) => ({ sessionId, title: p.title, kind: p.kind, ts: p.since })), ...list].slice(0, MAX_LOG)); // ponytail: ordre d'insertion, groupLog retrie par heure
      writePref(LOG_KEY, JSON.stringify(this.log()));
    }
    const fresh = sessions.filter((s) => needsYou(s.state) && before.get(s.id)?.state !== s.state);
    const system: SessionSummary[] = [];
    let chime: 'waiting' | 'turn' | null = null;
    for (const s of fresh) {
      const kind = s.state as 'waiting' | 'turn';
      const d = deliver(kind, this.context(s.id), this.prefs());
      if (d.toast) this.toast({ kind, sessionId: s.id });
      if (d.system) system.push(s);
      if (d.sound && chime !== 'waiting') chime = kind;
    }
    if (chime) this.chime(chime);
    if (system.length) this.notify(system);
    // Ménage : les toasts dont la session a changé d'état ne s'afficheront plus.
    const states = new Map(sessions.map((s) => [s.id, s.state]));
    this.toastList.update((list) => list.filter((t) => states.get(t.sessionId) === t.kind));
  }

  /** Seuils de consommation : au plus une alerte par jour (coût) et une par fenêtre de 5 h. */
  private checkUsage(usage: Usage, now: number, alerts: Alerts): void {
    const unsent = usageAlerts(usage, now, alerts, { cost: readPref(COST_ALERT_KEY), window: readPref(WINDOW_ALERT_KEY) });
    for (const a of unsent) {
      writePref(a.key === 'cost' ? COST_ALERT_KEY : WINDOW_ALERT_KEY, a.dismissKey);
      // ponytail: pas de toast pour la conso (Vigie au premier plan : la cloche et son point suffisent) ; en ajouter si on la rate.
      const d = deliver('usage', this.context(''), this.prefs());
      if (d.sound) this.chime('turn');
      if (d.system && this.granted()) this.show('', a.title, a.body, ['/usage']);
    }
  }

  private toast(t: Omit<Toast, 'id'>): void {
    const id = this.nextId++;
    this.toastList.update((list) => [...list.filter((x) => x.sessionId !== t.sessionId), { ...t, id }].slice(-MAX_TOASTS));
    if (t.kind === 'turn') setTimeout(() => this.closeToast(id), TOAST_MS);
  }

  private granted(): boolean {
    this.permission.set(this.currentPermission());
    return this.permission() === 'granted'; // sinon, les Réglages disent pourquoi
  }

  private notify(sessions: SessionSummary[]): void {
    if (!this.granted()) return;
    if (sessions.length > MAX_NOTIFICATIONS) {
      this.show('', `${sessions.length} sessions ont besoin de toi`, sessions.map((s) => s.title).join(' · '));
      return;
    }
    for (const s of sessions) this.show(s.id, headline(s), body(s));
  }

  private show(sessionId: string, title: string, body: string, link?: string[]): void {
    // silent : le son est celui de Vigie (réglable), pas celui du système.
    const n = new Notification(title, { body, tag: sessionId || link?.join('/') || 'vigie', silent: true });
    n.onclick = () => {
      this.win?.focus();
      if (link) void this.router.navigate(link);
      else if (sessionId) void this.router.navigate(['/sessions', sessionId]);
      n.close();
    };
  }

  /** Petit carillon synthétisé (pas de fichier audio) : ~0,3 s, volume discret. */
  private chime(kind: 'waiting' | 'turn'): void {
    const Ctx = this.win?.AudioContext;
    if (!Ctx) return;
    try {
      this.audio ??= new Ctx();
      const ctx = this.audio;
      void ctx.resume();
      const notes = kind === 'waiting' ? [660, 990] : [740];
      notes.forEach((freq, i) => {
        const t = ctx.currentTime + i * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch { /* audio indisponible : tant pis pour le son */ }
  }

  /** Fins de tour : réglage dédié, sinon déduit de l'ancien interrupteur unique (coupé → seulement dans l'app). */
  private loadTurn(): TurnPref {
    const v = readPref(TURN_KEY);
    if (v === 'inapp' || v === 'system' || v === 'off') return v;
    return readPref(NOTIFY_KEY) === 'off' ? 'inapp' : 'system';
  }

}

function headline(s: SessionSummary): string {
  if (s.state === 'turn') return 'Claude a fini, à toi';
  return s.reason === 'question' ? 'Claude te pose une question' : 'Claude demande une autorisation';
}

/** Notification système : titre de la session et la demande (le système l'affiche hors de Vigie, comme avant). */
function body(s: SessionSummary): string {
  return `${s.title}${s.detail ? ' — ' + s.detail : ''}`;
}
