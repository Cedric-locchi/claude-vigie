import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OUTDATED, PluginHost } from '@vigie/plugin-sdk';
import { callReplies, fakePluginHost } from '@vigie/plugin-sdk/testing';
import { XcodeTargets as XcodeTargetsSchema } from '../contract.mjs';
import { anXcodeProject, anXcodeTargets } from './fixtures';
import { XcodeVm } from './xcode.vm';

const BOOTED = '22222222-2222-2222-2222-222222222222';
const FIRST = '11111111-1111-1111-1111-111111111111';

let n = 0;
async function setup(targets: unknown = anXcodeTargets(), { project = anXcodeProject() as unknown, terminal = vi.fn(async () => undefined) as PluginHost['terminal'], cwd = `/p${++n}`, id = `s${n}`, wait = true } = {}) {
  const host = fakePluginHost({ sessionId: signal(id), cwd: signal(cwd), call: callReplies({ project, targets, open: null }), terminal });
  TestBed.configureTestingModule({ providers: [XcodeVm, { provide: PluginHost, useValue: host }] });
  const vm = TestBed.inject(XcodeVm);
  if (wait) await vi.waitFor(() => expect([vm.loading(), vm.container() ?? vm.targetsError()]).toEqual([false, expect.anything()]));
  return { vm, host };
}

describe('XcodeVm', () => {
  it('lit project et targets avec les schémas du plugin', async () => {
    const { host } = await setup();
    expect(host.call).toHaveBeenCalledWith('targets', {}, XcodeTargetsSchema, { signal: expect.any(AbortSignal) });
    expect(vi.mocked(host.call).mock.calls.map((c) => c[0]).sort()).toEqual(['project', 'targets']);
  });

  it('présélectionne le premier scheme et le premier simulateur démarré, groupés par runtime', async () => {
    const { vm } = await setup();
    expect([vm.container()?.name, vm.kindLabel(), vm.scripts()]).toEqual(['App.xcworkspace', 'Workspace', ['bootstrap.sh', 'lint.py']]);
    expect([vm.scheme(), vm.udid()]).toEqual(['App', BOOTED]);
    expect(vm.runtimes().map((g) => [g.runtime, g.sims.length])).toEqual([['iOS 18.0', 2], ['iOS 17.5', 1]]);
    expect(vm.simulatorLabel(BOOTED)).toBe('iPhone 16 Pro');
  });

  it('aucun simulateur démarré : le premier', async () => {
    const { vm } = await setup(anXcodeTargets({ simulators: anXcodeTargets().simulators.map((s) => ({ ...s, booted: false })) }));
    expect(vm.udid()).toBe(FIRST);
  });

  it("aucun simulateur démarré : un iPhone plutôt qu'un iPad trié avant", async () => {
    const sims = anXcodeTargets().simulators.map((s) => ({ ...s, booted: false }));
    const { vm } = await setup(anXcodeTargets({ simulators: [{ ...sims[0], udid: '44444444-4444-4444-4444-444444444444', name: 'iPad (A16)' }, ...sims] }));
    expect(vm.udid()).toBe(FIRST);
  });

  it('retient le choix par projet', async () => {
    const first = await setup(undefined, { cwd: '/ios' });
    first.vm.pickScheme('AppTests');
    first.vm.pickSimulator(FIRST);
    TestBed.resetTestingModule();
    const { vm } = await setup(undefined, { cwd: '/ios' });
    expect([vm.scheme(), vm.udid()]).toEqual(['AppTests', FIRST]);
  });

  it('envoie le scheme et le simulateur ; Clean sans simulateur ; scripts', async () => {
    const { vm, host } = await setup();
    await vm.run('run');
    expect(host.terminal).toHaveBeenCalledWith('run', { scheme: 'App', udid: BOOTED });
    await vm.run('clean');
    expect(host.terminal).toHaveBeenLastCalledWith('clean', { scheme: 'App' });
    await vm.runScript('lint.py');
    expect(host.terminal).toHaveBeenLastCalledWith('script', { name: 'lint.py' });
  });

  it('désactive les actions sans scheme, sans simulateur (sauf Clean) et pendant une requête', async () => {
    const noSim = (await setup(anXcodeTargets({ simulators: [] }))).vm;
    expect([noSim.canRun('run'), noSim.canRun('test'), noSim.canRun('clean')]).toEqual([false, false, true]);
    TestBed.resetTestingModule();
    const noScheme = (await setup(anXcodeTargets({ schemes: [] }))).vm;
    expect(noScheme.canRun('clean')).toBe(false);
    TestBed.resetTestingModule();

    let release!: () => void;
    const terminal = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { vm } = await setup(undefined, { terminal });
    const pending = vm.run('build');
    expect(vm.canRun('build')).toBe(false);
    await vm.run('test'); // ignorée : une requête à la fois
    expect(terminal).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(vm.canRun('build')).toBe(true);
  });

  it('Xcode indisponible : pas d’action, mais les scripts restent utilisables', async () => {
    const { vm, host } = await setup(anXcodeTargets({ available: false, schemes: [], simulators: [], error: 'xcode-select: error: tool requires Xcode' }));
    expect([vm.available(), vm.targets()?.error]).toEqual([false, 'xcode-select: error: tool requires Xcode']);
    expect(vm.canRun('clean')).toBe(false);
    await vm.runScript('bootstrap.sh');
    expect(host.terminal).toHaveBeenCalledWith('script', { name: 'bootstrap.sh' });
  });

  it('lecture en cours : état de chargement ; Rafraîchir relit', async () => {
    const { vm, host } = await setup(new Promise(() => undefined), { wait: false });
    await vi.waitFor(() => expect(vm.container()).not.toBeNull());
    expect([vm.loading(), vm.targets()]).toEqual([true, null]);
    vm.refresh();
    await vi.waitFor(() => expect(vi.mocked(host.call).mock.calls.filter((c) => c[0] === 'project')).toHaveLength(2));
  });

  it('réponse hors contrat : message « daemon à jour ? »', async () => {
    const { vm } = await setup({ available: 'oui' });
    expect([vm.targetsError(), vm.available()]).toEqual([OUTDATED, false]);
  });

  it('lancement refusé : message du daemon', async () => {
    const terminal = vi.fn(async () => { throw new Error('Scheme invalide'); });
    const { vm } = await setup(undefined, { terminal });
    await vm.run('build');
    expect([vm.launchError(), vm.launching()]).toEqual(['Scheme invalide', false]);
  });

  it('ouvre le projet dans Xcode par la méthode « open », sans terminal', async () => {
    const { vm, host } = await setup();
    await vm.openInXcode();
    expect(host.call).toHaveBeenCalledWith('open');
    expect(host.terminal).not.toHaveBeenCalled();
    expect(vm.launchError()).toBeNull();
  });
});
