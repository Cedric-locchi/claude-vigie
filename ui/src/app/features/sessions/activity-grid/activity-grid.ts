import { UsageRow } from '../../../core/models';
import { addDays, startOfDay, tokensOf } from '../../../core/usage-rows';

/** Case d'un jour : tokens, sessions distinctes et coût ; `level` 0 (rien) à 4 (le plus chargé) ; `future` : après aujourd'hui (non affiché). */
export interface ActivityDay { day: number; tokens: number; sessions: number; cost: number; level: 0 | 1 | 2 | 3 | 4; future: boolean }
export interface ActivityGrid {
  weeks: ActivityDay[][]; months: { col: number; label: string }[];
  /** Tokens cumulés de la période. */
  tokens: number;
  activeDays: number;
  /** Jours actifs d'affilée jusqu'à aujourd'hui (hier compte encore si aujourd'hui est vide). */
  streak: number;
  /** Jour le plus chargé en tokens, null si aucune activité. */
  peak: ActivityDay | null;
}

/** Semaines affichées avant la première mesure de largeur (~6 mois). */
export const WEEKS = 26;
/** Bornes de la grille : un trimestre en étroit, un an (53 semaines) au plus large. */
export const MIN_WEEKS = 13;
export const MAX_WEEKS = 53;
/** Historique qui couvre toujours MAX_WEEKS (lundi de la 1re colonne inclus). */
export const ACTIVITY_DAYS = MAX_WEEKS * 7;
/** Géométrie partagée avec le CSS du composant : colonne des jours, case visée, écart. */
export const LABEL_W = 28;
export const CELL = 15;
export const GAP = 3;

/** Semaines qui remplissent `width` px avec des cases de CELL px (bornées à [MIN_WEEKS, MAX_WEEKS]) ; le CSS absorbe le reste. */
export function weeksFor(width: number): number {
  const n = Math.floor((width - LABEL_W) / (CELL + GAP));
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, n));
}
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/**
 * Niveau d'un jour selon son rang parmi les jours actifs (quartiles) : un gros jour isolé n'écrase pas les autres
 * au niveau 1 (les tokens, cache compris, varient d'un facteur 100 d'un jour à l'autre). Le plus chargé est au niveau 4.
 */
function leveler(values: number[]): (v: number) => ActivityDay['level'] {
  const active = values.filter((v) => v > 0);
  // ponytail: rang par filtre, O(n²) sur ≤ 371 jours ; tri + recherche dichotomique si la période s'allonge.
  return (v) => (v > 0 ? (Math.ceil((active.filter((x) => x <= v).length / active.length) * 4) as ActivityDay['level']) : 0);
}

/**
 * Heatmap façon GitHub : une colonne par semaine (lundi en haut), la dernière contient aujourd'hui.
 * Intensité = tokens du jour (entrée, sortie, cache), en quartiles des jours actifs de la période.
 */
export function activityGrid(rows: UsageRow[], now: number, weeks = WEEKS): ActivityGrid {
  const today = startOfDay(now);
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7));
  const first = addDays(monday, -7 * (weeks - 1));

  const byDay = new Map<number, { ids: Set<string>; tokens: number; cost: number }>();
  for (const r of rows) {
    const day = startOfDay(r.day);
    if (day < first || day > today) continue;
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { ids: new Set(), tokens: 0, cost: 0 }));
    d.ids.add(r.sessionId);
    d.tokens += tokensOf(r);
    d.cost += r.cost;
  }
  const level = leveler([...byDay.values()].map((d) => d.tokens));

  const out: ActivityGrid = { weeks: [], months: [], tokens: 0, activeDays: 0, streak: 0, peak: null };
  let run = 0;
  for (let w = 0; w < weeks; w++) {
    const col: ActivityDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(first, w * 7 + i);
      const d = byDay.get(day);
      const tokens = d?.tokens ?? 0;
      col.push({ day, tokens, sessions: d?.ids.size ?? 0, cost: d?.cost ?? 0, level: level(tokens), future: day > today });
      if (day > today) continue;
      out.tokens += tokens;
      if (tokens) {
        out.activeDays++;
        run++;
        if (!out.peak || tokens > out.peak.tokens) out.peak = col[i];
      } else if (day < today) run = 0; // aujourd'hui encore vide ne casse pas la série
    }
    out.streak = run;
    // Libellé du mois sur la semaine qui en contient le 1er.
    const firstOfMonth = col.find((c) => new Date(c.day).getDate() === 1);
    if (firstOfMonth || w === 0) out.months.push({ col: w, label: MONTH.format(firstOfMonth?.day ?? col[0].day).replace('.', '') });
    out.weeks.push(col);
  }
  // Le libellé de la toute première colonne gêne celui du mois suivant s'il arrive juste après.
  if (out.months.length > 1 && out.months[1].col - out.months[0].col < 3) out.months.shift();
  return out;
}
