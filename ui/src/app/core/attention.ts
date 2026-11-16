// Règles des notifications, en fonctions pures (testées sans Angular) : ce qui est à traiter, le journal, la cloche, et où prévenir.
import { Alerts, SessionSummary, Usage } from './models';
import { describeSession, waitLabel } from './session-view';
import * as f from './format';

/** Ce qui a demandé ton attention, pour le journal : la raison d'une attente, ou une fin de tour. */
export type LogKind = 'permission' | 'question' | 'turn';
/** Ligne du journal « Plus tôt » (localStorage) : titre de session seulement, jamais le détail d'une commande. */
export interface LogEntry { sessionId: string; title: string; kind: LogKind; ts: number }

export const LOG_LABELS: Record<LogKind, string> = { permission: waitLabel('permission', 'short'), question: waitLabel('question', 'short'), turn: 'Fin de tour' };

/** Alerte de consommation active : `dismissKey` sert à « Ignorer » (jour pour le coût, fin de fenêtre pour la 5 h). */
export interface UsageAlert { key: 'cost' | 'window'; dismissKey: string; title: string; body: string; dismissLabel: string }

/** Seuils franchis en ce moment, hors alertes ignorées. */
export function usageAlerts(usage: Usage, now: number, alerts: Alerts | null, dismissed: { cost: string | null; window: string | null }): UsageAlert[] {
  const list: UsageAlert[] = [];
  if (!alerts) return list;
  const day = new Date(now).toDateString();
  if (alerts.dailyCost != null && usage.today.cost >= alerts.dailyCost && dismissed.cost !== day) {
    list.push({
      key: 'cost', dismissKey: day, dismissLabel: "Ignorer pour aujourd'hui",
      title: `Coût du jour ${f.usd(usage.today.cost)} (estimé)`, body: `Au-dessus de ton seuil de ${f.usd(alerts.dailyCost)}, au tarif API.`,
    });
  }
  const w = usage.window;
  if (alerts.windowPct != null && w.active && w.end != null && w.pct >= alerts.windowPct && dismissed.window !== String(w.end)) {
    list.push({
      key: 'window', dismissKey: String(w.end), dismissLabel: 'Ignorer pour cette fenêtre',
      title: `Fenêtre de 5 h à ${f.pct(w.pct)}${w.real ? '' : ' (estimé)'}`, body: `Ton seuil est à ${f.pct(alerts.windowPct)}. La fenêtre se termine à ${f.clock(w.end)}.`,
    });
  }
  return list;
}

/** Sessions à traiter, dérivées du snapshot : celles qui attendent d'abord, puis les fins de tour ; la plus ancienne en tête. */
export function pendingSessions(sessions: SessionSummary[], now: number) {
  return sessions
    .filter((s) => s.state === 'waiting' || s.state === 'turn')
    .sort((a, b) => (a.state === b.state ? 0 : a.state === 'waiting' ? -1 : 1) || a.lastTs - b.lastTs)
    .map((s) => describeSession(s, now, 1, 0));
}

/** Cloche : la pastille ambre ne compte que ce qui bloque ; le reste se dit dans l'aria-label et par un point neutre. */
export function bell(sessions: SessionSummary[], usageCount: number, pausedUntil: number | null) {
  const waiting = sessions.filter((s) => s.state === 'waiting');
  const turn = sessions.filter((s) => s.state === 'turn').length;
  const parts: string[] = [];
  if (waiting.length) {
    const what = waiting.every((s) => s.reason !== 'question') ? 'ton autorisation' : 'ta réponse';
    parts.push(waiting.length > 1 ? `${waiting.length} sessions attendent ${what}` : `1 session attend ${what}`);
  }
  if (turn) parts.push(`${turn} fin${turn > 1 ? 's' : ''} de tour`);
  if (usageCount) parts.push(`${usageCount} alerte${usageCount > 1 ? 's' : ''} de consommation`);
  if (pausedUntil) parts.push(`en pause jusqu'à ${f.clock(pausedUntil)}`);
  return { waiting: waiting.length, others: turn + usageCount > 0, label: parts.length ? `Notifications : ${parts.join(', ')}` : 'Notifications' };
}

/** Journal regroupé par session : dernière issue, ses heures (la plus récente d'abord) et leur nombre. */
export function groupLog(entries: LogEntry[]) {
  const groups = new Map<string, { sessionId: string; title: string; kind: LogKind; times: number[] }>();
  for (const e of [...entries].sort((a, b) => b.ts - a.ts)) {
    const g = groups.get(e.sessionId);
    if (g) g.times.push(e.ts);
    else groups.set(e.sessionId, { sessionId: e.sessionId, title: e.title, kind: e.kind, times: [e.ts] });
  }
  return [...groups.values()];
}

/** Heure d'une ligne du journal : « 14:32 », ou « lun. 14:32 » si ce n'est pas aujourd'hui. */
export function when(ts: number, now: number): string {
  const d = new Date(ts);
  return d.toLocaleString('fr-FR', { weekday: d.toDateString() === new Date(now).toDateString() ? undefined : 'short', hour: '2-digit', minute: '2-digit' });
}

export type TurnPref = 'inapp' | 'system' | 'off';
export interface Prefs { systemWaiting: boolean; turn: TurnPref; usage: boolean; sound: boolean }

/**
 * Où prévenir d'un événement.
 * - Vigie a le focus : toast dans l'app, sauf pour la session déjà affichée ; jamais de notification système.
 * - Sinon : notification système selon le réglage du type, sauf en pause.
 * - Son : selon le réglage, sauf en pause. Un type coupé (« rien ») ne prévient d'aucune façon.
 */
export function deliver(kind: 'waiting' | 'turn' | 'usage', ctx: { focused: boolean; shown: boolean; paused: boolean }, p: Prefs) {
  const enabled = kind === 'turn' ? p.turn !== 'off' : kind === 'usage' ? p.usage : true;
  if (!enabled) return { toast: false, system: false, sound: false };
  const systemPref = kind === 'waiting' ? p.systemWaiting : kind === 'turn' ? p.turn === 'system' : true;
  return {
    toast: ctx.focused && !ctx.shown,
    system: !ctx.focused && !ctx.paused && systemPref,
    sound: p.sound && !ctx.paused,
  };
}

/** Relit le journal mémorisé : toute ligne mal formée est ignorée (stockage local, éditable à la main). */
export function parseLog(raw: string | null): LogEntry[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((e): e is LogEntry => typeof e?.sessionId === 'string' && typeof e.title === 'string' && typeof e.ts === 'number' && e.kind in LOG_LABELS);
  } catch {
    return [];
  }
}
