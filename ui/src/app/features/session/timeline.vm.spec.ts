import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { SessionTrace } from '../../core/models';
import { fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { VigieService } from '../../core/vigie.service';
import { TimelineVm } from './timeline.vm';

const S = 1000, MIN = 60_000;
const TRACE: SessionTrace = {
  now: 30 * MIN, state: 'running', waiting: null,
  turns: [
    { index: 1, start: 0, end: MIN, prompt: 'Corrige', live: false, steps: [
      { id: 'r1', name: 'Read', kind: 'read', label: 'a.ts', start: 0, end: S, error: false, agent: null },
      { id: 'r2', name: 'Read', kind: 'read', label: 'b.ts', start: 2 * S, end: 3 * S, error: false, agent: null },
      { id: 'b1', name: 'Bash', kind: 'command', label: 'npm test', start: 4 * S, end: 40 * S, error: true, agent: null },
    ] },
    { index: 2, start: 20 * MIN, end: 30 * MIN, prompt: 'Explore', live: true, steps: [
      { id: 't1', name: 'Task', kind: 'agent', label: 'explorer', start: 20 * MIN, end: 25 * MIN, error: false,
        agent: { id: 'x', name: 'Explore', description: 'explorer le code', state: 'done', steps: [{ id: 'g1', name: 'Grep', kind: 'other', label: 'timeline', start: 21 * MIN, end: 21 * MIN + 500, error: false }] } },
    ] },
  ],
};

function createVm() {
  const sessionLog = vi.fn(async () => ({ entries: [] }));
  TestBed.configureTestingModule({ providers: [TimelineVm, provideVigieServiceMock({
    traceResource: (() => fakeResource(TRACE)) as unknown as VigieService['traceResource'],
    sessionLog: sessionLog as unknown as VigieService['sessionLog'],
  })] });
  const vm = TestBed.inject(TimelineVm);
  vm.connect(signal('S'), signal(1));
  return vm;
}
const turn = (vm: TimelineVm, index: number) => vm.turns().find((t) => t.index === index)!;
const blocks = (vm: TimelineVm, lane = 0) => vm.gantt()!.lanes[lane].blocks;

describe('TimelineVm · Gantt', () => {
  it('clic sur une étape groupée : ouvre son tour, déplie le groupe, la sélectionne', async () => {
    const vm = createVm();
    vm.setGanttWidth(100_000); // assez large pour que rien ne se regroupe
    expect(turn(vm, 1).open).toBe(false);
    const r2 = blocks(vm).find((b) => b.key === 'r2')!;
    expect(vm.pick(r2)).toBeNull();
    await Promise.resolve();
    expect(turn(vm, 1).open).toBe(true);
    expect(turn(vm, 2).open).toBe(true); // le tour ouvert par défaut le reste
    expect(vm.selected()).toBe('r2');
    expect(turn(vm, 1).rows.map((r) => r.stepId)).toContain('r2');
  });

  it("clic sur une étape d'un sous-agent : déplie l'appel qui l'a lancé", async () => {
    const vm = createVm();
    vm.setGanttWidth(100_000);
    vm.pick(blocks(vm, 1)[0]);
    await Promise.resolve();
    expect(vm.selected()).toBe('g1');
    expect(turn(vm, 2).rows.map((r) => r.stepId)).toEqual(['t1', 'g1']);
  });

  it('un bloc « ×N » zoome sur sa plage au lieu de sélectionner', () => {
    const vm = createVm();
    vm.setGanttWidth(200);
    const many = blocks(vm).find((b) => b.count > 1)!;
    expect(many.bars.map((b) => b.stepId)).toContain('r1');
    const scroll = vm.pick(many);
    expect(scroll).not.toBeNull();
    expect(vm.zoom()).toBeGreaterThan(1);
    expect(vm.selected()).toBeNull();
  });

  it('les filtres atténuent les barres ; choisir une barre masquée efface les filtres', async () => {
    const vm = createVm();
    vm.setGanttWidth(100_000);
    vm.setErrorsOnly(true);
    expect(blocks(vm).map((b) => [b.key, b.dim])).toEqual([['r1', true], ['r2', true], ['b1', false], ['t1', true]]);
    vm.pick(blocks(vm).find((b) => b.key === 'r1')!);
    await Promise.resolve();
    expect(vm.filtering()).toBe(false);
    expect(vm.selected()).toBe('r1');
  });

  it('glisser sur l’axe zoome sur la plage ; un simple clic ne fait rien ; « Tout voir » revient', () => {
    const vm = createVm();
    vm.dragStart(0.5);
    expect(vm.dragEnd()).toBeNull();
    expect(vm.zoom()).toBe(1);
    vm.dragStart(0.2);
    vm.dragMove(0.4);
    expect(vm.drag()).toEqual({ from: 0.2, to: 0.4 });
    expect(vm.dragEnd()).toBeCloseTo(1000); // plage centrée : 0,3 × 5000 − 500
    expect(vm.zoom()).toBeCloseTo(5);
    expect(vm.drag()).toBeNull();
    vm.resetZoom();
    expect(vm.zoom()).toBe(1);
  });

  it('une seule barre tabulable, qui suit le focus ; repères de tours et résumé pour lecteur d’écran', () => {
    const vm = createVm();
    vm.setGanttWidth(100_000);
    expect(vm.gantt()!.tab).toBe('r1');
    vm.focusBar('b1', 'Commande npm test');
    expect(vm.gantt()!.tab).toBe('b1');
    expect(vm.readout()).toBe('Commande npm test');
    expect(vm.gantt()!.labels.filter((l) => l.turn !== null).map((l) => l.text)).toEqual(['T1', 'T2']);
    expect(vm.gantt()!.summary).toBe('2 tours, 5 étapes dont 1 en erreur, 1 sous-agent : Explore, 6 min d’activité.');
  });
});
