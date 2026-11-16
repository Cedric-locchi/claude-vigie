import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, SessionState } from '../../../core/models';
import { aSessionCost, anAgent, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { VigieService } from '../../../core/vigie.service';
import { COST_REFRESH_MS, SessionCostVm } from './session-cost.vm';

const flush = () => new Promise((r) => setTimeout(r));

function createVm(sessionCost = vi.fn(async () => aSessionCost())) {
  TestBed.configureTestingModule({ providers: [SessionCostVm, provideVigieServiceMock({ sessionCost: sessionCost as unknown as VigieService['sessionCost'] })] });
  const vm = TestBed.inject(SessionCostVm);
  const src = { id: signal('s1'), state: signal<SessionState>('running'), lastTs: signal(1), agents: signal<Agent[]>([anAgent(), anAgent({ id: 'a1', name: 'Explore', sub: true })]) };
  vm.connect(src);
  return { vm, sessionCost, src };
}

describe('SessionCostVm', () => {
  afterEach(() => vi.useRealTimers());

  it('charge à l’ouverture, puis au plus toutes les 30 s sur activité, et tout de suite si l’état change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { vm, sessionCost, src } = createVm();
    TestBed.tick(); await flush();
    expect(sessionCost).toHaveBeenCalledTimes(1);
    expect(vm.series()!.series.map((s) => s.name)).toEqual(['Claude', 'Explore']);
    // Activité rapprochée (le détail bouge toutes les 400 ms) : rien.
    for (let i = 2; i < 6; i++) { src.lastTs.set(i); vi.advanceTimersByTime(400); TestBed.tick(); }
    src.agents.set([...src.agents()]); TestBed.tick();
    expect(sessionCost).toHaveBeenCalledTimes(1);
    // Changement d'état : tout de suite.
    src.state.set('turn'); TestBed.tick(); await flush();
    expect(sessionCost).toHaveBeenCalledTimes(2);
    // 30 s plus tard, une activité suffit.
    vi.advanceTimersByTime(COST_REFRESH_MS);
    src.lastTs.set(10); TestBed.tick(); await flush();
    expect(sessionCost).toHaveBeenCalledTimes(3);
  });

  it('état vide quand aucun coût', async () => {
    const { vm } = createVm(vi.fn(async () => aSessionCost({ points: [] })));
    TestBed.tick(); await flush();
    expect(vm.empty()).toBe(true);
  });

  it('erreur puis « Réessayer »', async () => {
    const sessionCost = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue(aSessionCost());
    const { vm } = createVm(sessionCost);
    TestBed.tick(); await flush();
    expect(vm.error()).toContain('Coût indisponible');
    vm.reload(); await flush();
    expect(vm.error()).toBeNull();
    expect(vm.empty()).toBe(false);
    expect(vm.label()).toContain('Explore');
  });
});
