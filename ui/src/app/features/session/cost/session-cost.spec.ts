import { describe, expect, it } from 'vitest';
import { aSessionCost } from '../../../core/vigie.service.mock';
import { cumulByAgent } from './session-cost';

const agents = [
  { id: 'main', name: 'Claude', sub: false },
  { id: 'a1', name: 'Explore', sub: true },
  { id: 'a2', name: 'Explore', sub: true },
];

describe('cumulByAgent', () => {
  it('cumule par agent sur une grille commune, principal en premier, noms uniques', () => {
    const s = cumulByAgent(aSessionCost({ points: [
      { ts: 2, agent: 'a1', cost: 0.1, tokens: 1 },
      { ts: 1, agent: 'main', cost: 0.4, tokens: 1 },
      { ts: 2, agent: 'main', cost: 0.2, tokens: 1 },
      { ts: 3, agent: 'a2', cost: 0.3, tokens: 1 },
    ] }), agents);
    expect(s.series.map((x) => [x.id, x.name])).toEqual([['main', 'Claude'], ['a1', 'Explore'], ['a2', 'Explore (2)']]);
    expect(s.series.map((x) => x.color)).not.toContain('var(--wait)');
    // Chaque agent a une valeur à chaque instant (empilement), valeur cumulée et non par tranche.
    expect(s.points.filter((p) => p.id === 'main').map((p) => p.value)).toEqual([0.4, expect.closeTo(0.6), expect.closeTo(0.6)]);
    expect(s.points.filter((p) => p.id === 'a2').map((p) => p.value)).toEqual([0, 0, 0.3]);
    expect(s.totals.map((t) => t.total)).toEqual([0.4, expect.closeTo(0.7), expect.closeTo(1)]);
    expect(s.totals[0].byAgent).toEqual([{ name: 'Claude', value: 0.4 }]);
  });

  it('agent inconnu du détail : son id sert de nom ; série vide sans point', () => {
    expect(cumulByAgent(aSessionCost({ points: [{ ts: 1, agent: 'zz', cost: 1, tokens: 1 }] }), []).series[0].name).toBe('zz');
    expect(cumulByAgent(aSessionCost({ points: [] }), agents)).toEqual({ series: [], points: [], totals: [] });
  });
});
