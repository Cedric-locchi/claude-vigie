// Calculs du Dashboard : fonctions pures, sans Angular (testées à part).
import { SessionSummary, UsageRow } from '../../../core/models';
import { addDays, startOfDay, sum } from '../../usage/usage-series';

/** Tiret d'une barre segmentée : vide, rempli (couleur de la carte), au-delà du seuil (rouge), ou état d'une session. */
export type Segment = 'off' | 'on' | 'hot' | 'wait' | 'turn' | 'ok';

/**
 * Barre de `n` tirets remplie à `ratio` (0 à 1, borné). Les tirets remplis à partir de `hotFrom` (part de la barre)
 * passent en rouge : on approche d'une limite. Jamais d'orange ici : il est réservé à ce qui attend l'utilisateur.
 */
export function segments(ratio: number, n: number, hotFrom = 1): Segment[] {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * n);
  return Array.from({ length: n }, (_, i) => (i >= filled ? 'off' : i >= Math.round(hotFrom * n) ? 'hot' : 'on'));
}

/** Un tiret par session (dans l'ordre reçu), coloré par état ; au plus `max` tirets. */
export function sessionSegments(list: SessionSummary[], max = 24): Segment[] {
  const kind = { waiting: 'wait', turn: 'turn', running: 'on', done: 'ok' } as const;
  return list.slice(0, max).map((s) => kind[s.state]);
}

/** Sens de la valeur du jour par rapport à la moyenne (flèche de tendance) ; null sans moyenne ou à égalité. */
export function trend(today: number, avg: number | undefined): 'up' | 'down' | null {
  if (avg == null || today === avg) return null;
  return today > avg ? 'up' : 'down';
}

/** Moyenne par jour des `days` jours complets avant aujourd'hui (jours vides compris). */
export function dailyAverage(rows: UsageRow[], now: number, days = 7): { cost: number; tokens: number } {
  const today = startOfDay(now);
  const from = addDays(today, -days);
  const s = sum(rows.filter((r) => r.day >= from && r.day < today));
  return { cost: s.cost / days, tokens: s.tokens / days };
}
