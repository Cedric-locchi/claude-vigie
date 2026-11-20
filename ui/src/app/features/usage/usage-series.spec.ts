import { describe, expect, it } from 'vitest';
import * as Plot from '@observablehq/plot';
import { UsageRow } from '../../core/models';
import { anUsageRow } from '../../core/vigie.service.mock';
import { heroChart, heroMargins, sessionsChart } from './usage-charts';
import { addDays } from '../../core/usage-rows';
import { colorOf, compact, dailyByFamily, dayIndexAt, dayTotals, daysBetween, daysOf, heroScale, niceTicks, sessionPoints, stripBlocks } from './usage-series';

const day = (m: number, d: number) => new Date(2026, m, d).getTime();
const row = (d: number, model: string, cost: number, extra: Partial<UsageRow> = {}) => anUsageRow({ day: d, model, cost, ...extra });

describe('séries de consommation', () => {
  it('jours : bornes incluses, robustes au changement d’heure', () => {
    expect(daysBetween(day(9, 20), day(10, 5))).toBe(17); // passage à l'heure d'hiver le 25 oct.
    expect(addDays(day(9, 24), 2)).toBe(day(9, 26));
  });

  it('par jour × famille, jours triés, sélection marquée', () => {
    const rows = [row(day(10, 2), 'claude-sonnet-5-5', 3), row(day(10, 1), 'claude-opus-5-5', 5), row(day(10, 2), 'claude-opus-5-5', 2), row(day(10, 2), 'claude-opus-5-1', 1)];
    const out = dailyByFamily(rows, 'cost', { from: day(10, 2), to: day(10, 2) });
    expect(out.map((p) => [new Date(p.day).getDate(), p.family, p.value, p.selected])).toEqual([[1, 'opus', 5, false], [2, 'opus', 3, true], [2, 'sonnet', 3, true]]);
    expect(dailyByFamily(rows, 'tokens', { from: 0, to: 0 })[0].value).toBe(10_000);
  });

  it('couleurs par famille, jamais l’ambre', () => {
    expect(['fable', 'opus', 'sonnet', 'haiku', 'inconnu'].map(colorOf)).not.toContain('var(--wait)');
    expect(colorOf('inconnu')).toBe('var(--neutral)');
  });

  it('totaux par jour : jours vides compris, cumul, dépassements du seuil, fenêtres du jour', () => {
    const span = { from: day(10, 1), to: day(10, 4) };
    const rows = [row(day(10, 1), 'claude-opus-5-5', 5), row(day(10, 3), 'claude-opus-5-5', 20), row(day(10, 3), 'claude-sonnet-5-5', 15)];
    const windows = [
      { start: day(10, 3) + 3_600_000, end: day(10, 3) + 6 * 3_600_000, tokens: 10, cost: 2, pct: 0.4 },
      { start: day(10, 3) + 7 * 3_600_000, end: day(10, 3) + 12 * 3_600_000, tokens: 10, cost: 2, pct: 0.7 },
      { start: day(10, 2), end: day(10, 2) + 5 * 3_600_000, tokens: 10, cost: 2, pct: null },
    ];
    const out = dayTotals(dailyByFamily(rows, 'cost', span), daysOf(span), 30, windows);
    expect(out.map((d) => [new Date(d.day).getDate(), d.total, d.cumul, d.over])).toEqual([[1, 5, 5, false], [2, 0, 5, false], [3, 35, 40, true], [4, 0, 40, false]]);
    expect(out[2].families).toEqual([{ family: 'opus', value: 20 }, { family: 'sonnet', value: 15 }]);
    expect([out[2].windows, out[2].peak, out[1].windows, out[1].peak]).toEqual([2, 0.7, 1, null]);
    expect(dayTotals([], daysOf(span), null).some((d) => d.over)).toBe(false); // sans seuil, rien ne dépasse
  });

  it('axe secondaire : graduations rondes, cumul ramené dans le domaine de gauche, seuil dans l’échelle s’il est proche', () => {
    expect(niceTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0.37)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(1800).map(compact('tokens'))).toEqual(['0', '500', '1 k', '1,5 k', '2 k']);
    const s = heroScale(37, 412, null);
    expect([s.top, s.right, s.ratio]).toEqual([40, [0, 200, 400, 600], 40 / 600]);
    expect(412 * s.ratio).toBeLessThanOrEqual(s.top); // le cumul final tient sous le haut de l'axe de gauche
    expect(heroScale(20, 100, 30).top).toBe(30); // seuil proche : l'échelle l'inclut
    expect(heroScale(5, 100, 1000).top).toBe(6); // seuil lointain : hors échelle, les barres restent lisibles
  });

  it('bande : pixels → jour, bornés à la période', () => {
    expect(dayIndexAt(0, 300, 30)).toBe(0);
    expect(dayIndexAt(9.9, 300, 30)).toBe(0);
    expect(dayIndexAt(10, 300, 30)).toBe(1);
    expect(dayIndexAt(299, 300, 30)).toBe(29);
    expect(dayIndexAt(-40, 300, 30)).toBe(0);
    expect(dayIndexAt(900, 300, 30)).toBe(29);
  });

  it('bande : fenêtres placées sur leur jour, intensité réelle ou relative', () => {
    const days = daysOf({ from: day(10, 1), to: day(10, 4) });
    const out = stripBlocks([
      { start: day(10, 2) + 6 * 3_600_000, end: day(10, 2) + 11 * 3_600_000, tokens: 100, cost: 8, pct: 0.5 },
      { start: day(10, 4) + 21 * 3_600_000, end: day(10, 5) + 2 * 3_600_000, tokens: 50, cost: 2, pct: null },
      { start: day(9, 1), end: day(9, 1) + 5 * 3_600_000, tokens: 1, cost: 1, pct: 0.9 }, // hors période
    ], days, 'cost');
    expect(out.map((b) => [b.left, b.real, b.level])).toEqual([[31.25, true, 0.5], [96.875, false, 0.25]]);
    expect(out[1].left + out[1].width).toBeLessThanOrEqual(100); // jamais au-delà de la bande
  });

  it('sessions : coût, taux de cache, signalées sous 50 %', () => {
    const rows = [
      row(day(10, 1), 'claude-opus-5-5', 5, { sessionId: 'a', input: 600, cacheCreate: 0, cacheRead: 400 }),
      row(day(10, 2), 'claude-haiku-5-5', 1, { sessionId: 'a', input: 0, cacheCreate: 0, cacheRead: 1000 }),
      row(day(10, 2), 'claude-opus-5-5', 2, { sessionId: 'b', input: 100, cacheCreate: 0, cacheRead: 900 }),
    ];
    const [a, b] = sessionPoints(rows);
    expect([a.id, a.cost, a.cacheRate, a.lowCache, a.models]).toEqual(['a', 6, 0.7, false, ['opus', 'haiku']]);
    expect(sessionPoints([rows[0]])[0].lowCache).toBe(true);
    expect(b.cacheRate).toBe(0.9);
  });
});

describe('graphiques Plot', () => {
  const span = { from: day(10, 1), to: day(10, 3) };
  const hero = (rows: UsageRow[], s: { from: number; to: number }, threshold: number | null, width: number, pick = (_d: number, _e: boolean) => undefined as void) => {
    const daily = dailyByFamily(rows, 'cost', s);
    const totals = dayTotals(daily, daysOf(s), threshold);
    const scale = heroScale(Math.max(...totals.map((t) => t.total)), totals.at(-1)!.cumul, threshold);
    const margins = heroMargins(scale, 'cost');
    return { svg: heroChart(daily, { metric: 'cost', families: ['opus', 'sonnet'], totals, scale, margins, threshold, pick })(Plot, width), margins };
  };

  it('rendent un SVG aux couleurs du thème, y compris vides ; le seuil est discret, le dépassement en corail', () => {
    const { svg } = hero([row(day(10, 2), 'claude-opus-5-5', 3), row(day(10, 3), 'claude-opus-5-5', 40)], span, 30, 375);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.innerHTML).toContain('var(--brand)');
    expect(svg.innerHTML).not.toContain('var(--wait)');
    expect(svg.textContent).toContain(`seuil ${compact('cost')(30)}`);
    expect(compact('cost')(30)).not.toContain(','); // graduations courtes : « 30 $ »
    expect(svg.innerHTML).toContain('stroke-dasharray="4 3"');
    expect(svg.querySelectorAll('[stroke="var(--err)"] line, line[stroke="var(--err)"]').length).toBe(1); // un seul jour au-dessus
    // Cache bas : triangle creux à l'encre, pas d'ambre.
    expect(sessionsChart(sessionPoints([row(day(10, 2), 'claude-opus-5-5', 3, { cacheRead: 0 })]), { metric: 'cost', open: () => undefined })(Plot, 375).innerHTML).toContain('stroke="var(--text)"');
  });

  for (const width of [375, 1200]) {
    it(`${width} px : libellés de dates espacés sur 90 jours, graduations des deux axes dans leurs marges`, () => {
      const long = { from: day(8, 15), to: addDays(day(8, 15), 89) };
      const rows = Array.from({ length: 90 }, (_, i) => row(addDays(long.from, i), 'claude-opus-5-5', 1234.5 + i * 37));
      const { svg, margins } = hero(rows, long, null, width);
      const xLabels = svg.querySelectorAll('[aria-label="x-axis tick label"] text');
      expect(xLabels.length).toBeGreaterThan(1);
      expect(xLabels.length * 52).toBeLessThanOrEqual(width - margins.left - margins.right + 52);
      const yLabels = [...svg.querySelectorAll('[aria-label="y-axis tick label"]')];
      expect(yLabels).toHaveLength(2); // gauche (coût par jour) et droite (cumul)
      const fits = (g: Element, side: 'left' | 'right') => {
        const texts = [...g.querySelectorAll('text')];
        const x = Number(texts[0].getAttribute('transform')?.match(/translate\(([\d.]+)/)?.[1] ?? 0);
        const longest = Math.max(...texts.map((t) => t.textContent!.length)) * 6.5;
        // Graduations posées sur l'axe, libellés à 9 px de lui (alignés à droite à gauche, à gauche à droite).
        return side === 'left' ? x === margins.left && x - 9 >= longest : x === width - margins.right && x + 9 + longest <= width;
      };
      expect(fits(yLabels[0], 'left')).toBe(true);
      expect(fits(yLabels[1], 'right')).toBe(true);
    });
  }

  it('clic dans une colonne : choisit le jour pointé, Maj étend', () => {
    const picked: [number, boolean][] = [];
    const { svg } = hero([row(day(10, 2), 'claude-opus-5-5', 3)], span, null, 600, (d, e) => { picked.push([d, e]); });
    (svg as Element & { value: unknown }).value = { day: day(10, 2) };
    svg.dispatchEvent(new MouseEvent('click', { shiftKey: true }));
    expect(picked).toEqual([[day(10, 2), true]]);
  });

  it('clic sur un point du nuage : ouvre la session pointée', () => {
    const opened: string[] = [];
    const svg = sessionsChart(sessionPoints([row(day(10, 2), 'claude-opus-5-5', 3, { sessionId: 'x' })]), { metric: 'cost', open: (id) => opened.push(id) })(Plot, 375);
    (svg as Element & { value: unknown }).value = { id: 'x' };
    svg.dispatchEvent(new MouseEvent('click'));
    expect(opened).toEqual(['x']);
  });
});
