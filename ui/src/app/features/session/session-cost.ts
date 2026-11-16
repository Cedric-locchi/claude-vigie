// Coût de la session au fil du temps, par agent : série cumulée (pure, testée) et graphique Plot.
import * as f from '../../core/format';
import { Agent, SessionCost } from '../../core/models';
import { type Draw, type PlotModule, frame, leftFor } from '../usage/usage-charts';

/** Couleurs de données (3:1 sur --surface, deux thèmes). Pas d'ambre : il est réservé à ce qui attend. */
// ponytail: 5 couleurs puis on recommence ; au-delà, deux sous-agents partagent une teinte (la légende et l'info-bulle les distinguent).
const PALETTE = ['var(--brand)', 'var(--cmd)', 'var(--ok)', 'var(--read)', 'var(--text-2)'];

export interface CostSerie { id: string; name: string; color: string; total: number }
export interface CostPoint { ts: number; id: string; value: number }
export interface CostTotal { ts: number; total: number; byAgent: { name: string; value: number }[] }
export interface CostSeries { series: CostSerie[]; points: CostPoint[]; totals: CostTotal[] }

/**
 * Cumule les tranches du daemon par agent sur une grille commune (chaque agent a une valeur à chaque instant :
 * l'empilement de Plot l'exige). Agent principal d'abord, puis par première apparition ; noms rendus uniques.
 */
export function cumulByAgent(cost: SessionCost, agents: Pick<Agent, 'id' | 'name' | 'sub'>[]): CostSeries {
  const slices = [...cost.points].sort((a, b) => a.ts - b.ts);
  const ids = [...new Set(slices.map((p) => p.agent))];
  const known = new Map(agents.map((a) => [a.id, a]));
  ids.sort((a, b) => Number(known.get(a)?.sub ?? true) - Number(known.get(b)?.sub ?? true));
  const seen = new Map<string, number>();
  const series: CostSerie[] = ids.map((id, i) => {
    const base = known.get(id)?.name || id;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id, name: n > 1 ? `${base} (${n})` : base, color: PALETTE[i % PALETTE.length], total: 0 };
  });
  const byId = new Map(series.map((s) => [s.id, s]));
  const points: CostPoint[] = [];
  const totals: CostTotal[] = [];
  for (const ts of [...new Set(slices.map((p) => p.ts))]) {
    for (const p of slices) if (p.ts === ts) byId.get(p.agent)!.total += p.cost;
    for (const s of series) points.push({ ts, id: s.id, value: s.total });
    totals.push({ ts, total: series.reduce((t, s) => t + s.total, 0), byAgent: series.filter((s) => s.total > 0).map((s) => ({ name: s.name, value: s.total })) });
  }
  return { series, points, totals };
}

/** Aires empilées par agent ; l'info-bulle détaille le cumul de chaque agent à l'instant pointé. */
export function costChart(data: CostSeries): Draw {
  // Marges calculées sur la plus grande graduation (gauche) et la moitié d'une heure « 14:05 » (droite) : rien ne déborde.
  const marginLeft = leftFor(Math.max(0, ...data.totals.map((t) => t.total)), f.usd);
  return (Plot: PlotModule, width: number) => Plot.plot({
    ...frame(width, 200, marginLeft, 24),
    x: { type: 'time', label: null, ticks: Math.max(2, Math.floor((width - marginLeft) / 64)), tickFormat: (d: Date) => f.clock(d.getTime()) },
    y: { label: null, grid: true, tickFormat: f.usd, ticks: 4, nice: true },
    color: { domain: data.series.map((s) => s.id), range: data.series.map((s) => s.color) },
    marks: [
      Plot.areaY(data.points, { x: (d: CostPoint) => new Date(d.ts), y: 'value', fill: 'id', fillOpacity: 0.85, curve: 'step-after', order: data.series.map((s) => s.id) }),
      Plot.tip(data.totals, Plot.pointerX({
        x: (d: CostTotal) => new Date(d.ts), y: 'total', stroke: 'var(--line-strong)', fontSize: 12,
        title: (d: CostTotal) => `${f.clock(d.ts)} · ${f.usd(d.total)} cumulés\n${d.byAgent.map((a) => `${a.name} : ${f.usd(a.value)}`).join('\n')}`,
      })),
      Plot.ruleY([0], { stroke: 'var(--line-strong)' }),
    ],
  });
}
