import { describe, expect, it } from 'vitest';
import { anUsageRow } from './vigie.service.mock';
import { addDays, startOfDay, sum, tokensOf } from './usage-rows';

/** Jour et heure locaux d'une date, pour des assertions vraies dans tout fuseau. */
const local = (ts: number) => { const d = new Date(ts); return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; };

describe('usage-rows', () => {
  it('additionne les lignes : tokens et part de l’entrée servie par le cache', () => {
    const t = sum([anUsageRow(), anUsageRow({ input: 0, output: 1_000, cacheCreate: 0, cacheRead: 0, cost: 0.8 })]);
    expect(t).toMatchObject({ input: 1_000, output: 3_000, cacheCreate: 500, cacheRead: 6_500 });
    expect(t.cost).toBeCloseTo(5);
    expect(t.tokens).toBe(11_000);
    expect(t.cacheRate).toBe(6_500 / 8_000);
    expect(tokensOf(anUsageRow())).toBe(10_000);
    expect(sum([])).toMatchObject({ tokens: 0, cost: 0, cacheRate: 0 }); // pas de division par zéro
  });

  it('compte en jours locaux, changements d’heure compris (fin mars, fin octobre)', () => {
    for (const [month, day] of [[2, 28], [9, 24]]) {
      const start = new Date(2026, month, day, 15, 30).getTime();
      expect(local(startOfDay(start))).toEqual([month + 1, day, 0, 0]);
      // 2 jours plus tard, à minuit local, même si l'un des deux jours fait 23 ou 25 heures.
      expect(local(addDays(start, 2))).toEqual([month + 1, day + 2, 0, 0]);
      expect(local(addDays(addDays(start, 2), -2))).toEqual([month + 1, day, 0, 0]);
    }
  });
});
