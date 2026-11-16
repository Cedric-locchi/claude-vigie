import { UsageRow } from '../../core/models';
import { addDays, startOfDay } from '../usage/usage-series';

/** Case d'un jour : sessions distinctes et coût ; `level` 0 (rien) à 4 (le plus actif) ; `future` : après aujourd'hui (non affiché). */
export interface ActivityDay { day: number; sessions: number; cost: number; level: 0 | 1 | 2 | 3 | 4; future: boolean }
export interface ActivityGrid { weeks: ActivityDay[][]; months: { col: number; label: string }[]; total: number; activeDays: number }

export const WEEKS = 53;
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/**
 * Grille façon GitHub : une colonne par semaine (lundi en haut), la dernière contient aujourd'hui.
 * Intensité = nombre de sessions du jour, rapporté au jour le plus chargé de la période.
 */
export function activityGrid(rows: UsageRow[], now: number, weeks = WEEKS): ActivityGrid {
  const today = startOfDay(now);
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7));
  const first = addDays(monday, -7 * (weeks - 1));

  const byDay = new Map<number, { ids: Set<string>; cost: number }>();
  for (const r of rows) {
    if (r.day < first) continue;
    let d = byDay.get(r.day);
    if (!d) byDay.set(r.day, (d = { ids: new Set(), cost: 0 }));
    d.ids.add(r.sessionId);
    d.cost += r.cost;
  }
  const max = Math.max(0, ...[...byDay.values()].map((d) => d.ids.size));

  const out: ActivityGrid = { weeks: [], months: [], total: 0, activeDays: 0 };
  for (let w = 0; w < weeks; w++) {
    const col: ActivityDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(first, w * 7 + i);
      const d = byDay.get(day);
      const sessions = d?.ids.size ?? 0;
      const level = (sessions && max ? Math.min(4, Math.ceil((sessions / max) * 4)) : 0) as ActivityDay['level'];
      col.push({ day, sessions, cost: d?.cost ?? 0, level, future: day > today });
      out.total += sessions;
      if (sessions) out.activeDays++;
    }
    // Libellé du mois sur la semaine qui en contient le 1er.
    const firstOfMonth = col.find((c) => new Date(c.day).getDate() === 1);
    if (firstOfMonth || w === 0) out.months.push({ col: w, label: MONTH.format(firstOfMonth?.day ?? col[0].day).replace('.', '') });
    out.weeks.push(col);
  }
  // Le libellé de la toute première colonne gêne celui du mois suivant s'il arrive juste après.
  if (out.months.length > 1 && out.months[1].col - out.months[0].col < 3) out.months.shift();
  return out;
}
