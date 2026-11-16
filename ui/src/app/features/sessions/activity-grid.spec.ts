import { UsageRow } from '../../core/models';
import { activityGrid } from './activity-grid';

const row = (day: number, sessionId: string, cost = 1): UsageRow => ({
  day, sessionId, title: 't', project: 'p', model: 'claude-opus-5-5', input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost,
});

describe('activityGrid', () => {
  // Mercredi 18 novembre 2026, 15 h (heure locale).
  const now = new Date(2026, 10, 18, 15).getTime();
  const day = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

  it('une colonne par semaine, lundi en haut, aujourd’hui dans la dernière', () => {
    const g = activityGrid([], now);
    expect(g.weeks).toHaveLength(53);
    const last = g.weeks.at(-1)!;
    expect(new Date(last[0].day).getDay()).toBe(1); // lundi
    expect(last[2].day).toBe(day(2026, 10, 18));
    expect(last[2].future).toBe(false);
    expect(last[3].future).toBe(true);
  });

  it('compte les sessions distinctes par jour et gradue sur le jour le plus chargé', () => {
    const rows = [
      row(day(2026, 10, 18), 'a'), row(day(2026, 10, 18), 'a', 2), row(day(2026, 10, 18), 'b'),
      row(day(2026, 10, 18), 'c'), row(day(2026, 10, 18), 'd'),
      row(day(2026, 10, 17), 'e'),
      row(day(2020, 0, 1), 'trop-vieux'),
    ];
    const g = activityGrid(rows, now);
    const last = g.weeks.at(-1)!;
    expect(last[2]).toMatchObject({ sessions: 4, cost: 6, level: 4 });
    expect(last[1]).toMatchObject({ sessions: 1, level: 1 });
    expect(last[0]).toMatchObject({ sessions: 0, level: 0 });
    expect(g.total).toBe(5);
    expect(g.activeDays).toBe(2);
  });

  it('un libellé par mois, sur la semaine qui contient le 1er', () => {
    const g = activityGrid([], now);
    const nov = g.months.find((m) => m.label === 'nov')!;
    expect(g.weeks[nov.col].some((c) => c.day === day(2026, 10, 1))).toBe(true);
    expect(g.months.length).toBeGreaterThanOrEqual(12);
  });
});
