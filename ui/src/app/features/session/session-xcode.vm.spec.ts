import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { XcodeProject, XcodeTargets } from '../../core/models';
import { VigieService } from '../../core/vigie.service';
import { aTerminal, anXcodeProject, anXcodeTargets, fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { SessionXcodeVm } from './session-xcode.vm';

const BOOTED = '22222222-2222-2222-2222-222222222222';
const FIRST = '11111111-1111-1111-1111-111111111111';

let n = 0;
function setup(targets: XcodeTargets | null = anXcodeTargets(), { project = anXcodeProject(), openShell = vi.fn(async () => aTerminal({ id: 't9', kind: 'shell' })), cwd = `/p${++n}`, status = 'resolved' as 'resolved' | 'loading', id = 's1' } = {}) {
  const res = fakeResource(targets ?? undefined, status);
  const openXcode = vi.fn(async () => ({ ok: true }));
  TestBed.configureTestingModule({
    providers: [SessionXcodeVm, provideVigieServiceMock({
      openShell: openShell as unknown as VigieService['openShell'],
      openXcode,
      xcodeTargetsResource: (() => res) as unknown as VigieService['xcodeTargetsResource'],
    })],
  });
  const vm = TestBed.inject(SessionXcodeVm);
  const opened = vi.fn();
  vm.connect(signal(id), signal(cwd), signal<XcodeProject | null>(project), opened);
  return { vm, opened, openShell, openXcode, res };
}

describe('SessionXcodeVm', () => {
  it('présélectionne le premier scheme et le premier simulateur démarré, groupés par runtime', () => {
    const { vm } = setup();
    expect([vm.container()?.name, vm.kindLabel()]).toEqual(['App.xcworkspace', 'Workspace']);
    expect([vm.scheme(), vm.udid()]).toEqual(['App', BOOTED]);
    expect(vm.runtimes().map((g) => [g.runtime, g.sims.length])).toEqual([['iOS 18.0', 2], ['iOS 17.5', 1]]);
    expect(vm.simulatorLabel(BOOTED)).toBe('iPhone 16 Pro');
  });

  it('aucun simulateur démarré : le premier', () => {
    const { vm } = setup(anXcodeTargets({ simulators: anXcodeTargets().simulators.map((s) => ({ ...s, booted: false })) }));
    expect(vm.udid()).toBe(FIRST);
  });

  it("aucun simulateur démarré : un iPhone plutôt qu'un iPad trié avant", () => {
    const sims = anXcodeTargets().simulators.map((s) => ({ ...s, booted: false }));
    const { vm } = setup(anXcodeTargets({ simulators: [{ ...sims[0], udid: 'IPAD', name: 'iPad (A16)' }, ...sims] }));
    expect(vm.udid()).toBe(FIRST);
  });

  it('retient le choix par projet', () => {
    const first = setup(undefined, { cwd: '/ios' });
    first.vm.pickScheme('AppTests');
    first.vm.pickSimulator(FIRST);
    TestBed.resetTestingModule();
    const { vm } = setup(undefined, { cwd: '/ios' });
    expect([vm.scheme(), vm.udid()]).toEqual(['AppTests', FIRST]);
  });

  it('envoie le scheme et le simulateur ; Clean sans simulateur', async () => {
    const { vm, openShell, opened } = setup();
    await vm.run('run');
    expect(openShell).toHaveBeenCalledWith('s1', { xcode: { action: 'run', scheme: 'App', udid: BOOTED } });
    expect(opened).toHaveBeenCalledWith('t9');
    await vm.run('clean');
    expect(openShell).toHaveBeenLastCalledWith('s1', { xcode: { action: 'clean', scheme: 'App' } });
    await vm.runScript('lint.py');
    expect(openShell).toHaveBeenLastCalledWith('s1', { script: 'lint.py' });
  });

  it('désactive les actions sans scheme, sans simulateur (sauf Clean) et pendant une requête', async () => {
    const noSim = setup(anXcodeTargets({ simulators: [] })).vm;
    expect([noSim.canRun('run'), noSim.canRun('test'), noSim.canRun('clean')]).toEqual([false, false, true]);
    TestBed.resetTestingModule();
    const noScheme = setup(anXcodeTargets({ schemes: [] })).vm;
    expect(noScheme.canRun('clean')).toBe(false);
    TestBed.resetTestingModule();

    let release!: () => void;
    const openShell = vi.fn(() => new Promise((r) => (release = () => r(aTerminal({ id: 't9' })))));
    const { vm } = setup(undefined, { openShell: openShell as never });
    const pending = vm.run('build');
    expect(vm.canRun('build')).toBe(false);
    await vm.run('test'); // ignorée : une requête à la fois
    expect(openShell).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(vm.canRun('build')).toBe(true);
  });

  it('Xcode indisponible : pas d’action, mais les scripts restent utilisables', async () => {
    const { vm, openShell } = setup(anXcodeTargets({ available: false, schemes: [], simulators: [], error: 'xcode-select: error: tool requires Xcode' }));
    expect([vm.available(), vm.targets()?.error]).toEqual([false, 'xcode-select: error: tool requires Xcode']);
    expect(vm.canRun('clean')).toBe(false);
    await vm.runScript('bootstrap.sh');
    expect(openShell).toHaveBeenCalledWith('s1', { script: 'bootstrap.sh' });
  });

  it('lecture en cours : état de chargement ; Rafraîchir relit', () => {
    const { vm, res } = setup(null, { status: 'loading', id: 'jamais-lue' }); // id neuf : le cache des dernières cibles est global
    expect([vm.loading(), vm.targets()]).toEqual([true, null]);
    vm.refresh();
    expect(res.reload).toHaveBeenCalled();
  });

  it('lancement refusé (400) : message du daemon, pas de terminal', async () => {
    const openShell = vi.fn(async () => { throw Object.assign(new Error('http'), { status: 400, error: { error: 'Scheme inconnu : App' } }); });
    const { vm, opened } = setup(undefined, { openShell: openShell as never });
    await vm.run('build');
    expect([vm.launchError(), vm.launching()]).toEqual(['Scheme inconnu : App', false]);
    expect(opened).not.toHaveBeenCalled();
  });

  it('ouvre le projet dans Xcode', async () => {
    const { vm, openXcode, opened } = setup();
    await vm.openInXcode();
    expect(openXcode).toHaveBeenCalledWith('s1');
    expect(opened).not.toHaveBeenCalled();
  });
});
