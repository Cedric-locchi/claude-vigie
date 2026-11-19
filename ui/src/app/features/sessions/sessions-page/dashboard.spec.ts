import { describe, expect, it } from 'vitest';
import { aSession, anUsageRow } from '../../../core/vigie.service.mock';
import { addDays } from '../../usage/usage-series';
import { dailyAverage, segments, sessionSegments, trend } from './dashboard';

const TODAY = new Date(2026, 10, 18).getTime();
const NOW = TODAY + 15 * 3_600_000;

describe('dashboard', () => {
  it('barre segmentée : remplie au ratio, rouge au-delà du seuil, bornée', () => {
    expect(segments(0.62, 10)).toEqual(['on', 'on', 'on', 'on', 'on', 'on', 'off', 'off', 'off', 'off']);
    expect(segments(0.9, 10, 0.8)).toEqual(['on', 'on', 'on', 'on', 'on', 'on', 'on', 'on', 'hot', 'off']);
    expect(segments(1.7, 4, 0)).toEqual(['hot', 'hot', 'hot', 'hot']);
    expect(segments(-1, 3)).toEqual(['off', 'off', 'off']);
  });

  it('un tiret par session, coloré par état, plafonné', () => {
    const list = [aSession({ state: 'waiting' }), aSession({ state: 'turn' }), aSession({ state: 'running' }), aSession({ state: 'done' })];
    expect(sessionSegments(list)).toEqual(['wait', 'turn', 'on', 'ok']);
    expect(sessionSegments(list, 2)).toHaveLength(2);
  });

  it('tendance du jour face à la moyenne : rien sans moyenne ni à égalité', () => {
    expect(trend(5, 3)).toBe('up');
    expect(trend(1, 3)).toBe('down');
    expect(trend(3, 3)).toBeNull();
    expect(trend(3, undefined)).toBeNull();
  });

  it('moyenne des 7 jours complets avant aujourd’hui, jours vides compris', () => {
    const rows = [
      anUsageRow({ day: TODAY, cost: 100, output: 1e6 }), // aujourd'hui : exclu
      anUsageRow({ day: addDays(TODAY, -1), cost: 7, input: 0, output: 7000, cacheCreate: 0, cacheRead: 0 }),
      anUsageRow({ day: addDays(TODAY, -7), cost: 7, input: 0, output: 7000, cacheCreate: 0, cacheRead: 0 }),
      anUsageRow({ day: addDays(TODAY, -8), cost: 50 }), // trop vieux
    ];
    expect(dailyAverage(rows, NOW)).toEqual({ cost: 2, tokens: 2000 });
  });

});
