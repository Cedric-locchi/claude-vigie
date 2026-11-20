// Mise en forme des séries de la page Consommation : fonctions pures, sans Angular ni Plot (testées à part).
import * as f from '../../core/format';
import { QuotaBlock, UsageRow } from '../../core/models';
import { addDays, startOfDay, sum } from '../../core/usage-rows';

export type Metric = 'cost' | 'tokens';
export interface Range { from: number; to: number } // débuts de jour locaux, bornes incluses

/** Nombre de jours de `from` à `to` inclus. */
export const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000) + 1;

/** opus, sonnet, haiku, fable… : la couleur et le filtre se font par famille. */
export const familyOf = (model: string) => model.match(/claude-([a-z]+)/)?.[1] ?? model;
const FAMILY_ORDER = ['fable', 'opus', 'sonnet', 'haiku'];
export const byFamily = (a: string, b: string) => (FAMILY_ORDER.indexOf(a) + 1 || 99) - (FAMILY_ORDER.indexOf(b) + 1 || 99);
/** Couleurs de données (3:1 sur --surface, deux thèmes). Pas d'ambre : il est réservé à ce qui attend. */
// ponytail: fable sur --text-2 faute de jeton dédié ; ajouter un --data-* dans styles.css si une 5e famille arrive.
const FAMILY_COLOR: Record<string, string> = { fable: 'var(--text-2)', opus: 'var(--brand)', sonnet: 'var(--data)', haiku: 'var(--read)' };
export const colorOf = (family: string) => FAMILY_COLOR[family] ?? 'var(--neutral)';

const usdInt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
/** Format court des graduations et du seuil : « 30 $ » plutôt que « 30,00 $ » quand la valeur est entière ;
 *  « 1,5 k » et non « 2 k » (f.tokens arrondit les milliers) pour que deux graduations ne se confondent pas. */
export const compact = (metric: Metric) => (n: number) => {
  if (metric === 'tokens') return n >= 1e3 && n < 1e6 && n % 1e3 ? `${(n / 1e3).toLocaleString('fr-FR')} k` : f.tokens(n);
  return Number.isInteger(n) ? usdInt.format(n) : f.usd(n);
};

export function groupBy<K>(rows: UsageRow[], key: (r: UsageRow) => K): Map<K, UsageRow[]> {
  const m = new Map<K, UsageRow[]>();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
}

/** Par modèle exact : sommes et part du coût, du plus coûteux au moins coûteux. */
export function byModel(rows: UsageRow[]) {
  const total = Math.max(1e-9, sum(rows).cost);
  return [...groupBy(rows, (r) => r.model)]
    .map(([model, rs]) => { const s = sum(rs); return { model, family: familyOf(model), ...s, share: s.cost / total }; })
    .sort((a, b) => b.cost - a.cost);
}

const measure = (rows: UsageRow[], metric: Metric) => (metric === 'cost' ? sum(rows).cost : sum(rows).tokens);
export const inRange = (day: number, r: Range) => day >= r.from && day <= r.to;

export interface DayPoint { day: number; family: string; value: number; tokens: number; cost: number; selected: boolean }

/** Une valeur par jour × famille (jours vides omis), triée par famille pour un empilement stable. */
export function dailyByFamily(rows: UsageRow[], metric: Metric, selection: Range): DayPoint[] {
  const out: DayPoint[] = [];
  for (const [key, rs] of groupBy(rows, (r) => `${startOfDay(r.day)}|${familyOf(r.model)}`)) {
    const [day, family] = [Number(key.split('|')[0]), key.slice(key.indexOf('|') + 1)];
    const s = sum(rs);
    out.push({ day, family, value: measure(rs, metric), tokens: s.tokens, cost: s.cost, selected: inRange(day, selection) });
  }
  return out.sort((a, b) => a.day - b.day || byFamily(a.family, b.family));
}

/** Jours de la période, du plus ancien au plus récent. */
export function daysOf(span: Range): number[] {
  const days: number[] = [];
  for (let d = span.from; d <= span.to; d = addDays(d, 1)) days.push(d);
  return days;
}

export interface DayTotal {
  day: number; total: number; cumul: number; over: boolean;
  families: { family: string; value: number }[];
  windows: number; peak: number | null; // fenêtres de 5 h ouvertes ce jour-là, plus haut % relevé
}

/** Total, détail par famille et cumul pour chaque jour de la période (jours vides compris) ; `over` : au-dessus du seuil. */
export function dayTotals(points: DayPoint[], days: number[], threshold: number | null, windows: QuotaBlock[] = []): DayTotal[] {
  let cumul = 0;
  return days.map((day) => {
    const ps = points.filter((p) => p.day === day);
    const ws = windows.filter((w) => startOfDay(w.start) === day);
    const total = ps.reduce((t, p) => t + p.value, 0);
    const pcts = ws.flatMap((w) => (w.pct == null ? [] : [w.pct]));
    return {
      day, total, cumul: (cumul += total), over: threshold != null && total > threshold,
      families: ps.map((p) => ({ family: p.family, value: p.value })), windows: ws.length, peak: pcts.length ? Math.max(...pcts) : null,
    };
  });
}

/** Graduations « rondes » de 0 à au moins `max` (pas de 1, 2 ou 5 × 10^n), environ `count` intervalles. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * (1 - 1e-9))!;
  const n = Math.ceil(max / step - 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/** Échelles du graphique héros. Plot n'a qu'un axe des ordonnées : le cumul est ramené dans le domaine de gauche
 *  (`ratio`), et l'axe de droite affiche ses graduations converties. Le seuil élargit l'échelle s'il reste proche
 *  des barres (≤ 2 × le maximum), sinon il est hors échelle (légende seulement). */
export interface HeroScale { top: number; left: number[]; right: number[]; ratio: number }
export function heroScale(dailyMax: number, cumulMax: number, threshold: number | null): HeroScale {
  const ref = threshold != null && threshold <= 2 * dailyMax ? Math.max(dailyMax, threshold) : dailyMax;
  const left = niceTicks(ref);
  const right = niceTicks(cumulMax);
  return { left, right, top: left.at(-1)!, ratio: left.at(-1)! / right.at(-1)! };
}

/** Jour (index) sous `x` px d'une bande large de `width` px découpée en `n` jours égaux, borné à la période. */
export const dayIndexAt = (x: number, width: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((x / Math.max(1, width)) * n)));

export interface StripBlock { start: number; end: number; left: number; width: number; level: number; real: boolean; pct: number | null }

/** Fenêtres de 5 h placées sur la bande (en % de sa largeur, un jour = 1/n). Intensité : % relevé si réel,
 *  sinon valeur relative à la plus grosse fenêtre de la période (estimée). */
export function stripBlocks(windows: QuotaBlock[], days: number[], metric: Metric): StripBlock[] {
  const n = days.length;
  const value = (w: QuotaBlock) => (metric === 'cost' ? w.cost : w.tokens);
  const max = Math.max(1e-9, ...windows.map(value));
  return windows.flatMap((w) => {
    const i = days.indexOf(startOfDay(w.start));
    if (i < 0) return [];
    const dayLen = addDays(days[i], 1) - days[i];
    const left = ((i + (w.start - days[i]) / dayLen) / n) * 100;
    const width = Math.min(100 - left, ((w.end - w.start) / dayLen / n) * 100);
    return [{ start: w.start, end: w.end, left, width, level: Math.min(1, w.pct ?? value(w) / max), real: w.pct != null, pct: w.pct }];
  }).sort((a, b) => a.start - b.start);
}

export interface SessionPoint { id: string; title: string; project: string; cost: number; tokens: number; cacheRate: number; lowCache: boolean; models: string[] }

/** Sous 50 % de lecture cache, une session recharge beaucoup de contexte : à surveiller. */
export const LOW_CACHE = 0.5;

export function sessionPoints(rows: UsageRow[]): SessionPoint[] {
  return [...groupBy(rows, (r) => r.sessionId)].map(([id, rs]) => {
    const s = sum(rs);
    return { id, title: rs[0].title, project: rs[0].project, cost: s.cost, tokens: s.tokens, cacheRate: s.cacheRate, lowCache: s.cacheRate < LOW_CACHE, models: [...new Set(rs.map((r) => familyOf(r.model)))].sort(byFamily) };
  });
}
