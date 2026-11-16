import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anUsage } from '../../../core/vigie.service.mock';
import { UsagePageComponent } from './usage-page.component';
import { PERIODS, UsagePageVm } from './usage-page.vm';
import { compact } from '../usage-series';

const TODAY = new Date(2026, 10, 13).getTime();
const draw = () => () => document.createElementNS('http://www.w3.org/2000/svg', 'svg');

function render(overrides: Record<string, unknown> = {}) {
  const usage = anUsage();
  const vm = {
    now: signal(0), window: signal(usage.window), windowBar: signal({ used: 62, projected: 24 }), loaded: signal(true), failed: signal(false), noWindows: signal(false),
    periods: PERIODS, period: signal('14'), metric: signal('cost'), metricLabel: signal('Coût'), family: signal(null), families: signal(['opus', 'sonnet']),
    rangeLabel: signal('14 derniers jours'), custom: signal(false),
    daily: signal([{ day: 1, family: 'opus', value: 40 }]), heroDraw: signal(draw()), heroLabel: signal('Coût par jour : 40 $'),
    dayTotals: signal([{ day: TODAY, total: 40, cumul: 40, over: true, families: [], windows: 2, peak: 0.74 }]), spanDays: signal([TODAY]),
    cumulTotal: signal(40), overDays: signal(1), threshold: signal(null), margins: signal({ left: 44, right: 40 }),
    strip: signal([{ start: TODAY, end: TODAY + 1, left: 10, width: 2, level: 0.5, real: true, pct: 0.5 }]), selectionBox: signal({ left: 0, width: 100 }),
    format: (n: number) => `${n} $`, brushStart: vi.fn(), brushMove: vi.fn(), brushEnd: vi.fn(), brushKey: vi.fn(() => true),
    sessionsDraw: signal(draw()), sessionsLabel: signal('1 session'),
    totals: signal({ cost: 50, perDay: 3.57, tokens: 6000, output: 3000, cacheRate: 0.75, input: 0, cacheCreate: 0, cacheRead: 0 }),
    models: signal([{ model: 'claude-opus-5-5', family: 'opus', cost: 40, share: 0.8, input: 1000, output: 2000, cacheCreate: 0, cacheRead: 3000, tokens: 6000, cacheRate: 0.75 }]),
    projects: signal([{ project: 'meeplebox', value: 40, width: 100, label: '40,00 $' }]),
    topSessions: signal([{ id: 's1', title: 'Refonte navigation', project: 'revu', tokens: 2_400_000, cost: 12, cacheRate: 0.38, lowCache: true, models: ['opus'] }]),
    setPeriod: vi.fn(), setMetric: vi.fn(), setFamily: vi.fn(), resetSelection: vi.fn(),
    ...overrides,
  };
  TestBed.configureTestingModule({ providers: [provideRouter([])] })
    .overrideComponent(UsagePageComponent, { set: { providers: [{ provide: UsagePageVm, useValue: vm }] } });
  const fixture = TestBed.createComponent(UsagePageComponent);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, vm };
}

describe('UsagePageComponent', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
  afterEach(() => vi.unstubAllGlobals());

  it('affiche coûts par modèle, projets et sessions coûteuses, sans ambre pour le cache bas', () => {
    const { el } = render();
    expect(el.textContent).toContain('claude-opus-5-5');
    expect(el.textContent).toContain('meeplebox');
    expect(el.textContent).toContain('38 % · à surveiller');
    expect(el.querySelector('td.watch')).not.toBeNull();
    expect(el.querySelector('td.wait')).toBeNull();
  });

  it("précise quand la fenêtre est une estimation", () => {
    expect(render().el.textContent).toContain('Estimation');
  });

  it('affiche les chiffres réels et le quota hebdomadaire', () => {
    const real = { ...anUsage().window, real: true, weekPct: 0.31 };
    const { el } = render({ window: signal(real) });
    expect(el.textContent).not.toContain('Estimation');
    expect(el.textContent).toContain('semaine 31 %');
  });

  it('graphique héros : alternative accessible, tableau des jours, cumul en en-tête', () => {
    const { el } = render();
    const charts = [...el.querySelectorAll('app-plot-chart')];
    expect(charts.map((c) => c.getAttribute('role'))).toEqual(['img', 'img']); // héros + nuage des sessions
    expect(charts[0].getAttribute('aria-label')).toBe('Coût par jour : 40 $');
    expect(el.querySelector('.hero .total')!.textContent).toBe('40 $');
    const row = el.querySelector('table.sr-only tbody tr')!;
    expect(row.textContent).toContain('13 novembre');
    expect(row.textContent).toContain('pic 74 %');
    expect(el.querySelector('a[href="/settings"]')!.textContent).toBe('Régler un seuil');
  });

  it('seuil réglé : légende « seuil » et dépassements, plus de lien', () => {
    const { el } = render({ threshold: signal(30) });
    expect(el.querySelector('a[href="/settings"]')).toBeNull();
    expect(el.textContent).toContain(`seuil ${compact('cost')(30)}`);
    expect(el.textContent).toContain('au-dessus du seuil');
    expect(el.querySelector('table.sr-only tbody tr')!.textContent).toContain('dépassé');
  });

  it('bande des fenêtres : focusable, clavier et glisser transmis au VM', () => {
    const { el, vm } = render();
    const strip = el.querySelector<HTMLElement>('.strip')!;
    expect(strip.tabIndex).toBe(0);
    expect(strip.style.paddingLeft || strip.parentElement!.style.paddingLeft).toBe('44px');
    const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, cancelable: true });
    strip.dispatchEvent(key);
    expect(vm.brushKey).toHaveBeenCalledWith('ArrowLeft', true);
    expect(key.defaultPrevented).toBe(true);
    strip.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0 }));
    expect(vm.brushStart).toHaveBeenCalledWith(0, false);
    strip.dispatchEvent(new PointerEvent('pointerup'));
    expect(vm.brushEnd).toHaveBeenCalled();
  });

  it('graphiques vides et daemon sans historique des fenêtres', () => {
    const { el } = render({ daily: signal([]), topSessions: signal([]) });
    expect(el.querySelectorAll('app-plot-chart')).toHaveLength(0);
    expect(el.textContent).toContain('lance une session');
    TestBed.resetTestingModule();
    expect(render({ noWindows: signal(true) }).el.textContent).toContain('redémarre-le après la mise à jour');
  });

  it('filtres : période, mesure, modèle ; sélection à la main réinitialisable', () => {
    const { el, vm } = render({ custom: signal(true) });
    const btn = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === label)!;
    btn('90 j').click();
    expect(vm.setPeriod).toHaveBeenCalledWith('90');
    btn('Ce mois').click();
    expect(vm.setPeriod).toHaveBeenCalledWith('month');
    btn('Tokens').click();
    expect(vm.setMetric).toHaveBeenCalledWith('tokens');
    btn('sonnet').click();
    expect(vm.setFamily).toHaveBeenCalledWith('sonnet');
    btn('Toute la période').click();
    expect(vm.resetSelection).toHaveBeenCalled();
  });

  it('dit quand le daemon ne fournit pas le détail', () => {
    expect(render({ failed: signal(true) }).el.textContent).toContain('redémarre-le');
  });
});
