import { TestBed } from '@angular/core/testing';
import { Signal, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { Usage, UsageRow, UsageRows } from '../../core/models';
import { aSettings, aSnapshot, anUsage, anUsageRow, fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { VigieService } from '../../core/vigie.service';
import { UsagePageVm } from './usage-page.vm';
import { addDays } from './usage-series';

const TODAY = new Date(2026, 10, 13).getTime(); // 13 novembre
const NOW = TODAY + 15 * 3_600_000;
const row = (offset: number, model: string, cost: number, extra: Partial<UsageRow> = {}): UsageRow =>
  anUsageRow({ day: addDays(TODAY, offset), sessionId: 's1', title: 'Refonte', project: 'revu', model, input: 0, output: 1000, cacheCreate: 0, cacheRead: 0, cost, ...extra });
const ROWS: UsageRows = {
  now: NOW, since: addDays(TODAY, -43),
  rows: [
    row(-20, 'claude-opus-5-5', 7), // hors 14 j, dans le mois précédent
    row(-13, 'claude-opus-5-5', 10),
    row(0, 'claude-opus-5-5', 30, { cacheRead: 3000, input: 1000 }),
    row(0, 'claude-sonnet-5-5', 10, { sessionId: 's2', title: 'Doc', project: 'meeplebox' }),
  ],
  windows: [
    { start: TODAY + 3_600_000, end: TODAY + 6 * 3_600_000, tokens: 5000, cost: 12, pct: 0.74 },
    { start: addDays(TODAY, -2), end: addDays(TODAY, -2) + 5 * 3_600_000, tokens: 2000, cost: 4, pct: null },
  ],
};

function createVm(usage: Usage = anUsage(), rows: UsageRows = ROWS, dailyCost: number | null = null) {
  let days: Signal<number> | null = null;
  TestBed.configureTestingModule({
    providers: [UsagePageVm, provideRouter([]), provideVigieServiceMock({
      snapshot: signal(aSnapshot({ now: NOW, usage })),
      usageResource: ((d: Signal<number>) => { days = d; return fakeResource(rows); }) as unknown as VigieService['usageResource'],
      settingsResource: (() => fakeResource(aSettings({ alerts: { dailyCost, windowPct: null } }))) as unknown as VigieService['settingsResource'],
    })],
  });
  const vm = TestBed.inject(UsagePageVm);
  return { vm, days: () => days!() };
}

describe('UsagePageVm', () => {
  it('découpe la barre de fenêtre en consommé + projection, bornée à 100 %', () => {
    expect(createVm().vm.windowBar()).toEqual({ used: 62, projected: 24 });
    TestBed.resetTestingModule();
    const u = anUsage();
    expect(createVm({ ...u, window: { ...u.window, pct: 0.9, projectedPct: 1.6 } }).vm.windowBar()).toEqual({ used: 90, projected: 10 });
  });

  it('demande au daemon les jours de la période', () => {
    const { vm, days } = createVm();
    expect(days()).toBe(14);
    vm.setPeriod('90');
    expect(days()).toBe(90);
    vm.setPeriod('month');
    expect(vm.span().from).toBe(new Date(2026, 10, 1).getTime());
    expect(vm.rangeLabel()).toBe('Depuis le 1er novembre');
    vm.setPeriod('n’importe quoi');
    expect(vm.period()).toBe('month');
  });

  it('totaux, modèles, projets et sessions suivent la période', () => {
    const { vm } = createVm();
    expect(vm.totals().cost).toBe(50);
    expect(vm.rangeLabel()).toBe('14 derniers jours');
    vm.setPeriod('1');
    expect(vm.rangeLabel()).toBe("Aujourd'hui");
    expect(vm.totals().cost).toBe(40);
    expect(vm.models().map((m) => [m.model, m.share])).toEqual([['claude-opus-5-5', 0.75], ['claude-sonnet-5-5', 0.25]]);
    expect(vm.projects().map((p) => p.project)).toEqual(['revu', 'meeplebox']);
    expect(vm.topSessions()[0].cacheRate).toBe(0.75);
    vm.setPeriod('30');
    expect(vm.totals().cost).toBe(57);
  });

  it('filtre par famille de modèle (désélection : toutes)', () => {
    const { vm } = createVm();
    vm.setFamily('sonnet');
    expect(vm.totals().cost).toBe(10);
    expect(vm.daily().map((d) => d.family)).toEqual(['sonnet']);
    vm.setFamily(null);
    expect(vm.family()).toBeNull();
  });

  it('clic sur un jour : ce jour ; Maj+clic : étend ; re-clic : toute la période', () => {
    const { vm } = createVm();
    const d5 = addDays(TODAY, -5);
    vm.pickDay(d5, false);
    expect(vm.selection()).toEqual({ from: d5, to: d5 });
    expect(vm.custom()).toBe(true);
    expect(vm.daily().find((p) => p.day === TODAY)!.selected).toBe(false);
    vm.pickDay(TODAY, true);
    expect(vm.selection()).toEqual({ from: d5, to: TODAY });
    expect(vm.totals().cost).toBe(40);
    vm.pickDay(TODAY, false);
    vm.pickDay(TODAY, false);
    expect(vm.custom()).toBe(false);
    vm.pickDay(d5, false);
    vm.setPeriod('30'); // changer de période efface la sélection
    expect(vm.custom()).toBe(false);
  });

  it('graphique héros : cumul de la période, bande des fenêtres et nuage de sessions', () => {
    const { vm } = createVm();
    expect(vm.dayTotals()).toHaveLength(14);
    expect(vm.cumulTotal()).toBe(50);
    expect(vm.threshold()).toBeNull();
    expect(vm.heroLabel()).toBe(`Coût par jour, 14 derniers jours : ${vm.format(50)} cumulés sur la période, maximum ${vm.format(40)} le 13 novembre. Détail jour par jour dans le tableau qui suit.`);
    expect(vm.strip().map((b) => [b.real, b.level])).toEqual([[false, 1 / 3], [true, 0.74]]);
    expect(vm.margins().left).toBeGreaterThanOrEqual(36);
    vm.setMetric('tokens');
    expect(vm.cumulTotal()).toBe(7000);
    expect(vm.strip()[0].level).toBe(0.4); // estimée : relative à la plus grosse fenêtre, en tokens
    expect(vm.lowCacheCount()).toBe(1); // s2 : rien lu depuis le cache
    expect(vm.sessionsLabel()).toContain('1 sous 50 %');
    expect(vm.heroLabel()).toContain('Tokens par jour');
  });

  it('seuil de coût du jour : dépassements comptés, ignoré en tokens', () => {
    const { vm } = createVm(anUsage(), ROWS, 30);
    expect(vm.threshold()).toBe(30);
    expect(vm.overDays()).toBe(1);
    expect(vm.dayTotals().at(-1)!.over).toBe(true);
    expect(vm.heroLabel()).toContain(`1 jour au-dessus du seuil de ${vm.format(30)}`);
    vm.setMetric('tokens');
    expect(vm.threshold()).toBeNull();
    expect(vm.overDays()).toBe(0);
  });

  it('bande : glisser sélectionne une plage, Maj+appui l’étend', () => {
    const { vm } = createVm();
    const day = (i: number) => vm.spanDays()[i];
    vm.brushStart(10, false);
    vm.brushMove(6);
    vm.brushMove(4);
    vm.brushEnd();
    expect(vm.selection()).toEqual({ from: day(4), to: day(10) });
    expect(vm.selectionBox()).toEqual({ left: (4 / 14) * 100, width: (7 / 14) * 100 });
    vm.brushMove(0); // pointeur relâché : plus d'effet
    expect(vm.selection().from).toBe(day(4));
    vm.brushStart(12, true);
    vm.brushEnd();
    expect(vm.selection()).toEqual({ from: day(4), to: day(12) });
    expect(vm.totals().cost).toBe(0); // jours -9 à -1 : rien
    vm.brushStart(2, false);
    expect(vm.selection()).toEqual({ from: day(2), to: day(2) });
  });

  it('bande au clavier : flèches, Maj pour étendre, Début / Fin, Échap pour tout reprendre', () => {
    const { vm } = createVm();
    const day = (i: number) => vm.spanDays()[i];
    expect(vm.brushKey('Escape', false)).toBe(false); // rien à reprendre : la touche reste libre
    expect(vm.brushKey('Enter', false)).toBe(false);
    vm.brushKey('ArrowLeft', false); // première touche : le jour le plus récent
    expect(vm.selection()).toEqual({ from: day(13), to: day(13) });
    vm.brushKey('ArrowLeft', false);
    expect(vm.selection()).toEqual({ from: day(12), to: day(12) });
    vm.brushKey('ArrowLeft', true);
    vm.brushKey('ArrowLeft', true);
    expect(vm.selection()).toEqual({ from: day(10), to: day(12) });
    vm.brushKey('End', true);
    expect(vm.selection()).toEqual({ from: day(12), to: day(13) });
    vm.brushKey('ArrowRight', false); // déjà au bout : reste borné
    expect(vm.selection()).toEqual({ from: day(13), to: day(13) });
    expect(vm.brushKey('Escape', false)).toBe(true);
    expect(vm.custom()).toBe(false);
    vm.brushKey('Home', false);
    expect(vm.selection()).toEqual({ from: day(0), to: day(0) });
  });

  it('daemon sans historique des fenêtres : on le dit', () => {
    const { vm } = createVm(anUsage(), { ...ROWS, windows: undefined });
    expect(vm.noWindows()).toBe(true);
    expect(vm.strip()).toEqual([]);
  });

  it('ouvre une session cliquée dans le nuage', () => {
    const { vm } = createVm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vm.openSession('s2');
    expect(navigate).toHaveBeenCalledWith(['/sessions', 's2']);
  });
});
