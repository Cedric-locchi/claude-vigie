// Graphiques de la page Consommation (Observable Plot, décision 017). Chaque fabrique rend une fonction `Draw`
// appelée par <app-plot-chart> avec le module Plot (chargé à la demande) et la largeur disponible.
// Couleurs en variables CSS : le SVG suit le thème sans redessin.
import type * as PlotNs from '@observablehq/plot';
import * as f from '../../core/format';
import { DayPoint, DayTotal, HeroScale, Metric, SessionPoint, colorOf, compact } from './usage-series';

export type PlotModule = typeof PlotNs;
export type Draw = (Plot: PlotModule, width: number) => Element;

const fmt = (metric: Metric) => (n: number) => (metric === 'cost' ? f.usd(n) : f.tokens(n));
const dayLabel = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Largeur d'un libellé d'axe à 11 px. ponytail: estimation par caractère (≈ 6,5 px), mesurer via canvas si une police plus large arrive. */
const textWidth = (label: string) => Math.ceil(label.length * 6.5);
/** Marge gauche qui contient la plus longue graduation de l'axe des ordonnées (bornée : 36 à 96 px). */
export const leftFor = (max: number, format: (n: number) => string) => Math.min(96, Math.max(36, textWidth(format(max)) + 12));

/** Gabarit commun : texte atténué, info-bulle sur fond de popover, police de l'app (11 px plancher).
 *  Pas d'`overflow: visible` : les marges sont calculées pour contenir les graduations, rien ne déborde de la carte. */
export const frame = (width: number, height: number, marginLeft: number, marginRight = 16) => ({
  width, height, marginLeft, marginRight, marginTop: 16, marginBottom: 28,
  style: 'color: var(--text-muted); --plot-background: var(--popover); font: 11px Inter, system-ui, sans-serif;',
});
const tip = { stroke: 'var(--line-strong)', fontSize: 12 };
const baseline = (Plot: PlotModule) => Plot.ruleY([0], { stroke: 'var(--line-strong)' });

/** Clic sur un élément pointé par Plot (`svg.value` = la donnée sous le pointeur). */
function onPick<T>(svg: Element, pick: (v: T, e: MouseEvent) => void): Element {
  svg.addEventListener('click', (e) => {
    const v = (svg as Element & { value?: T }).value;
    if (v) pick(v, e as MouseEvent);
  });
  return svg;
}

/** Marges du graphique héros : la gauche contient la plus haute graduation du coût par jour, la droite celle du cumul
 *  (libellés à 9 px de l'axe). 30 px minimum à droite : la moitié du dernier libellé de date y déborde. */
export function heroMargins(scale: HeroScale, metric: Metric) {
  const format = compact(metric);
  return { left: leftFor(scale.top, format), right: Math.max(30, textWidth(format(scale.right.at(-1)!)) + 12) };
}

export interface HeroOptions {
  metric: Metric; families: string[]; totals: DayTotal[]; scale: HeroScale; margins: { left: number; right: number };
  threshold: number | null; pick: (day: number, extend: boolean) => void;
}

/** Graphique héros : barres par jour empilées par famille, cumul de la période sur l'axe de droite, seuil en pointillé.
 *  Échelle à bandes linéaire (un jour = 1/n de la largeur utile, `paddingOuter` = moitié de l'intérieur, sans arrondi) :
 *  la bande des fenêtres de 5 h, en HTML sous le graphique, s'aligne dessus avec les mêmes marges.
 *  Hors sélection, les barres s'effacent ; au-dessus du seuil, un liseré corail coiffe la barre.
 *  Info-bulle unique par jour ; clic : ce jour, Maj+clic : étend. */
export function heroChart(data: DayPoint[], o: HeroOptions): Draw {
  const format = fmt(o.metric);
  const short = compact(o.metric);
  const { totals, scale, margins } = o;
  const days = totals.map((t) => t.day);
  const threshold = o.threshold != null && o.threshold <= scale.top ? o.threshold : null;
  const title = (t: DayTotal) => [
    dayLabel(t.day),
    `${format(t.total)} au total`,
    ...t.families.map((x) => `  ${x.family} ${format(x.value)}`),
    `cumul ${format(t.cumul)}`,
    t.windows ? `${t.windows} fenêtre${t.windows > 1 ? 's' : ''} de 5 h${t.peak != null ? `, pic ${f.pct(t.peak)}` : ' (estimées)'}` : 'aucune fenêtre de 5 h close',
    ...(t.over ? [`au-dessus du seuil de ${format(o.threshold!)}`] : []),
  ].join('\n');
  return (Plot, width) => {
    // Un libellé « 13 nov. » ≈ 48 px : on n'en garde qu'un tous les `step` jours, en partant du plus récent.
    const step = Math.max(1, Math.ceil((days.length * 52) / Math.max(1, width - margins.left - margins.right)));
    const ticks = days.filter((_, i) => (days.length - 1 - i) % step === 0);
    const padding = days.length > 45 ? 0.1 : 0.2;
    return onPick<DayTotal>(Plot.plot({
      ...frame(width, width < 500 ? 200 : 260, margins.left, margins.right),
      x: { type: 'band', domain: days, label: null, ticks, tickFormat: (d: number) => shortDate(new Date(d)), paddingInner: padding, paddingOuter: padding / 2, round: false },
      y: { domain: [0, scale.top], label: null },
      color: { domain: o.families, range: o.families.map(colorOf) },
      marks: [
        Plot.gridY(scale.left),
        Plot.axisY(scale.left, { tickFormat: short, label: null }),
        Plot.axisY(scale.right.map((v) => v * scale.ratio), { anchor: 'right', tickFormat: (v: number) => short(v / scale.ratio), label: null }),
        Plot.barY(data, { x: 'day', y: 'value', fill: 'family', fillOpacity: (d: DayPoint) => (d.selected ? 1 : 0.3) }),
        Plot.tickY(totals.filter((t) => t.over), { x: 'day', y: 'total', stroke: 'var(--err)', strokeWidth: 2 }),
        threshold == null ? null : Plot.ruleY([threshold], { stroke: 'var(--text-muted)', strokeDasharray: '4 3' }),
        threshold == null ? null : Plot.text([threshold], {
          y: (v: number) => v, frameAnchor: 'left', textAnchor: 'start', dx: 4, dy: -8, text: () => `seuil ${short(threshold)}`,
          fill: 'var(--text-muted)', stroke: 'var(--surface)', strokeWidth: 3, paintOrder: 'stroke',
        }),
        Plot.lineY(totals, { x: 'day', y: (t: DayTotal) => t.cumul * scale.ratio, stroke: 'var(--text)', strokeWidth: 2, curve: 'monotone-x' }),
        Plot.dot(totals.slice(-1), { x: 'day', y: (t: DayTotal) => t.cumul * scale.ratio, r: 3, fill: 'var(--text)' }),
        baseline(Plot),
        Plot.tip(totals, Plot.pointerX({ x: 'day', y: 'total', ...tip, title })),
      ],
    }), (t, e) => o.pick(t.day, e.shiftKey));
  };
}

/** d. Nuage des sessions : coût (ou tokens) × taux de cache. Sous 50 % : triangle creux. Clic : ouvre la session. */
export function sessionsChart(data: SessionPoint[], o: { metric: Metric; open: (id: string) => void }): Draw {
  const format = fmt(o.metric);
  const x = (d: SessionPoint) => (o.metric === 'cost' ? d.cost : d.tokens);
  const maxX = Math.max(0, ...data.map(x));
  return (Plot, width) => onPick<SessionPoint>(Plot.plot({
    // Graduation la plus à droite centrée sur le bord : la marge droite en contient la moitié.
    ...frame(width, 220, leftFor(1, (v) => f.pct(v)), Math.max(16, Math.ceil(textWidth(format(maxX)) / 2) + 6)),
    x: { label: null, nice: true, tickFormat: format, ticks: Math.max(2, Math.floor(width / 100)) },
    y: { label: null, domain: [0, 1], grid: true, tickFormat: (v: number) => f.pct(v), ticks: 5 },
    marks: [
      Plot.ruleY([0.5], { stroke: 'var(--line-strong)', strokeDasharray: '4 3' }),
      Plot.dot(data.filter((d) => !d.lowCache), { x, y: 'cacheRate', r: 4, fill: 'var(--brand)', stroke: 'var(--surface)' }),
      Plot.dot(data.filter((d) => d.lowCache), { x, y: 'cacheRate', r: 5, symbol: 'triangle', stroke: 'var(--text)', strokeWidth: 1.5, fill: 'none' }),
      Plot.tip(data, Plot.pointer({
        x, y: 'cacheRate', ...tip,
        title: (d: SessionPoint) => `${d.title}\n${d.project} · ${d.models.join(', ')}\n${f.usd(d.cost)} · ${f.tokens(d.tokens)} tok\ncache ${f.pct(d.cacheRate)}${d.lowCache ? ' · à surveiller' : ''}`,
      })),
    ],
  }), (d) => o.open(d.id));
}
