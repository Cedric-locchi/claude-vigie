import { UsageRow } from '../../../core/models';
import { MAX_WEEKS, MIN_WEEKS, activityGrid, weeksFor } from './activity-grid';

const row = (day: number, sessionId: string, tokens = 1000, cost = 1): UsageRow => ({
  day, sessionId, title: 't', project: 'p', model: 'claude-opus-5-5', input: 0, output: tokens, cacheCreate: 0, cacheRead: 0, cost,
});

describe('activityGrid', () => {
  // Mercredi 18 novembre 2026, 15 h (heure locale).
  const now = new Date(2026, 10, 18, 15).getTime();
  const day = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

  it('26 colonnes par défaut, lundi en haut, aujourd’hui dans la dernière', () => {
    const g = activityGrid([], now);
    expect(g.weeks).toHaveLength(26);
    const last = g.weeks.at(-1)!;
    expect(new Date(last[0].day).getDay()).toBe(1); // lundi
    expect(last[2].day).toBe(day(2026, 10, 18));
    expect(last[2].future).toBe(false);
    expect(last[3].future).toBe(true);
    expect(g.peak).toBeNull();
  });

  it('additionne les tokens du jour (cache compris), compte les sessions et ignore ce qui sort de la période', () => {
    const rows = [
      row(day(2026, 10, 18), 'a', 1000), row(day(2026, 10, 18), 'a', 500), { ...row(day(2026, 10, 18), 'b', 0), cacheRead: 2000, input: 500 },
      row(day(2026, 10, 17), 'c', 100),
      row(day(2020, 0, 1), 'trop-vieux', 9e9),
    ];
    const g = activityGrid(rows, now);
    const last = g.weeks.at(-1)!;
    expect(last[2]).toMatchObject({ tokens: 4000, sessions: 2, cost: 3, level: 4 });
    expect(last[1]).toMatchObject({ tokens: 100, level: 2 });
    expect(last[0]).toMatchObject({ tokens: 0, level: 0 });
    expect(g).toMatchObject({ tokens: 4100, activeDays: 2 });
    expect(g.peak?.day).toBe(day(2026, 10, 18));
  });

  it('niveaux par rang (quartiles) : un gros jour isolé ne relègue pas les autres au niveau 1', () => {
    const rows = [1, 2, 3, 1000].map((t, i) => row(day(2026, 10, 10 + i), `s${i}`, t));
    const levels = activityGrid(rows, now).weeks.flat().filter((d) => d.tokens).map((d) => d.level);
    expect(levels).toEqual([1, 2, 3, 4]);
  });

  it('série en cours ; aujourd’hui vide ne la casse pas', () => {
    const rows = [row(day(2026, 10, 12), 'a'), row(day(2026, 10, 16), 'd'), row(day(2026, 10, 17), 'e')];
    expect(activityGrid(rows, now).streak).toBe(2);
    expect(activityGrid(rows, day(2026, 10, 20)).streak).toBe(0); // deux jours vides : série cassée
  });

  it('un libellé par mois, sur la semaine qui contient le 1er', () => {
    const g = activityGrid([], now);
    const nov = g.months.find((m) => m.label === 'nov')!;
    expect(g.weeks[nov.col].some((c) => c.day === day(2026, 10, 1))).toBe(true);
    expect(g.months.length).toBeGreaterThanOrEqual(6);
  });

  it('plage affichée réduite : pic, jours actifs et total ne comptent que les semaines visibles', () => {
    const rows = [row(day(2026, 10, 17), 'a', 100), row(day(2026, 5, 1), 'vieux', 9000)];
    const wide = activityGrid(rows, now, 53);
    const narrow = activityGrid(rows, now, 13);
    expect(wide).toMatchObject({ tokens: 9100, activeDays: 2 });
    expect(wide.peak?.tokens).toBe(9000);
    expect(narrow.weeks).toHaveLength(13);
    expect(narrow).toMatchObject({ tokens: 100, activeDays: 1 });
    expect(narrow.peak?.tokens).toBe(100);
    expect(narrow.weeks.at(-1)![2].day).toBe(day(2026, 10, 18));
  });
});

describe('weeksFor', () => {
  it('remplit la largeur avec des cases de 15px + 3px d’écart, entre 13 et 53 semaines', () => {
    expect(weeksFor(28 + 30 * 18)).toBe(30);
    expect(weeksFor(28 + 30 * 18 + 17)).toBe(30); // le reste (< une case) est absorbé par le CSS
    expect(weeksFor(300)).toBe(15); // téléphone de 375px : la carte tient 15 semaines, sans défilement
    expect(weeksFor(200)).toBe(MIN_WEEKS);
    expect(weeksFor(0)).toBe(MIN_WEEKS);
    expect(weeksFor(4000)).toBe(MAX_WEEKS);
  });
});
