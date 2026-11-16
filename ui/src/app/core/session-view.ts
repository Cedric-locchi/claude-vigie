// Lecture d'une session pour l'affichage, partagée par le tableau de bord et la sidebar.
import { Agent, SessionState, SessionSummary } from './models';

export const STATE_LABELS = { waiting: 'Attend', turn: 'À toi', running: 'En cours', done: 'Terminée' } as const;

type Reason = NonNullable<SessionSummary['reason']>;
/** Seul jeu de libellés d'attente de l'app : long (en-tête, chronologie), court (badges). Sans raison connue : autorisation. */
const WAIT_LABELS = {
  permission: { long: 'Attend ton autorisation', short: 'Autorisation' },
  question: { long: 'Attend ta réponse', short: 'Question' },
} as const;
export const waitLabel = (reason: Reason | undefined, size: 'long' | 'short') => WAIT_LABELS[reason ?? 'permission'][size];

/** Libellé de badge d'une session ; une attente dit sa raison. */
export const stateLabel = (state: SessionState, reason: Reason | undefined, size: 'long' | 'short' = 'short') =>
  state === 'waiting' ? waitLabel(reason, size) : STATE_LABELS[state];

/** Libellé de badge d'un agent : un souci passe avant l'état ; « Terminé » au masculin. */
export const agentLabel = (a: Agent) => (a.issue ? 'Souci' : a.state === 'done' ? 'Terminé' : stateLabel(a.state, a.reason));

/** Urgence pour le tri : autorisation/question, puis fin de tour, puis en cours, puis terminées. */
export const rank = (s: SessionSummary) => ({ waiting: 0, turn: 1, running: 2, done: 3 })[s.state];

/** Plus gros nombre d'événements par minute : met l'activité de toutes les sessions à la même échelle. */
export const activityMax = (list: SessionSummary[]) => Math.max(1, ...list.flatMap((s) => s.activity ?? []));

export function describeSession(s: SessionSummary, now: number, max: number, sparkHeight: number) {
  return {
    s,
    label: stateLabel(s.state, s.reason),
    urgent: s.state === 'waiting',
    /** Ce qui se passe : la demande en attente, l'outil en cours, ou le dernier message. */
    doing: s.state === 'waiting'
      ? (s.reason === 'question' ? `Question : ${s.detail || 'en pause'}` : `Veut lancer ${s.detail ?? s.tool ?? ''}`)
      : s.state === 'turn' ? 'Tour terminé, à toi' : s.state === 'running' ? (s.tool ?? 'réfléchit…') : (s.lastText || '—'),
    canAllow: s.state === 'waiting' && s.reason === 'permission' && !!s.terminalId,
    spark: (s.activity ?? []).map((n) => (n ? Math.max(2, Math.round((n / max) * sparkHeight)) : 0)),
    /** Silence depuis plus de 5 min alors qu'elle est censée tourner : peut-être bloquée. */
    stale: s.state === 'running' && (s.activity ?? []).slice(-5).every((n) => !n),
    /** En attente : depuis quand ; sinon durée totale. */
    age: s.state === 'waiting' || s.state === 'turn' ? now - s.lastTs : s.lastTs - s.firstTs,
  };
}

export type SessionView = ReturnType<typeof describeSession>;
