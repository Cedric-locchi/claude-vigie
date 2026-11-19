import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OUTDATED, PluginHost } from '@vigie/plugin-sdk';
import { callReplies, fakePluginHost } from '@vigie/plugin-sdk/testing';
import { NxGraph as NxGraphSchema, NxInfo as NxInfoSchema } from '../contract.mjs';
import NxTabComponent from './index';
import type { NxGraph, NxInfo } from './models';
import { NOT_RUNNABLE, NX_MISSING, NxVm } from './nx.vm';

const target = (name: string, over: Partial<NxGraph['projects'][number]['targets'][number]> = {}) =>
  ({ name, command: `vite ${name}`, description: '', runnable: true, ...over });
const aGraph = (over: Partial<NxGraph> = {}): NxGraph => ({
  available: true, truncated: false, error: null,
  projects: [
    { name: 'api', type: 'app', root: 'apps/api', targets: [target('build', { description: 'Construit l’API' }), target('serve')] },
    { name: 'ui-kit', type: 'lib', root: 'libs/ui-kit', targets: [target('lint:fix', { runnable: false }), target('test')] },
  ],
  ...over,
});
const anInfo = (over: Partial<NxInfo> = {}): NxInfo => ({ local: true, telemetry: false, ...over });

// Chaque spec a son id de session : le dernier graphe est mémorisé par session (module).
let n = 0;
async function setup(replies: Record<string, unknown> = {}, over: Partial<PluginHost> = {}) {
  const host = fakePluginHost({ sessionId: signal(`nx-${++n}`), call: callReplies({ info: anInfo(), graph: aGraph(), ...replies }), ...over });
  TestBed.configureTestingModule({ providers: [NxVm, { provide: PluginHost, useValue: host }] });
  const vm = TestBed.inject(NxVm);
  await vi.waitFor(() => { TestBed.tick(); expect(vm.loading()).toBe(false); expect(vm.info() ?? vm.error()).toBeTruthy(); });
  return { vm, host };
}

describe('NxVm', () => {
  it('les réponses factices respectent le contrat du plugin', () => {
    expect(NxInfoSchema.safeParse(anInfo()).success).toBe(true);
    expect(NxGraphSchema.safeParse(aGraph()).success).toBe(true);
  });

  it('lit « info » puis « graph » : source de nx et projets', async () => {
    const { vm, host } = await setup();
    await vi.waitFor(() => expect(vm.projects()).toHaveLength(2));
    expect(host.call).toHaveBeenCalledWith('info', {}, NxInfoSchema, { signal: expect.any(AbortSignal) });
    expect(host.call).toHaveBeenCalledWith('graph', {}, NxGraphSchema, { signal: expect.any(AbortSignal) });
    expect([vm.source(), vm.error(), vm.telemetry()]).toEqual(['nx du dépôt (node_modules/.bin/nx)', null, false]);
  });

  it('nx du PATH', async () => {
    const { vm } = await setup({ info: anInfo({ local: false }) });
    expect(vm.source()).toBe('nx du PATH');
  });

  it('télémétrie active : le graphe n’est jamais demandé', async () => {
    const { vm, host } = await setup({ info: anInfo({ telemetry: true }) });
    expect(vm.telemetry()).toBe(true);
    expect(host.call).not.toHaveBeenCalledWith('graph', expect.anything(), expect.anything());
    expect(vm.projects()).toEqual([]);
  });

  it('nx introuvable, erreur de nx, réponse hors contrat', async () => {
    let s = await setup({ graph: aGraph({ available: false, projects: [] }) });
    await vi.waitFor(() => expect(s.vm.error()).toBe(NX_MISSING));
    TestBed.resetTestingModule();
    s = await setup({ graph: aGraph({ projects: [], error: 'nx ne répond pas' }) });
    await vi.waitFor(() => expect(s.vm.error()).toBe('nx ne répond pas'));
    TestBed.resetTestingModule();
    s = await setup({ graph: { projects: 'nope' } });
    await vi.waitFor(() => expect(s.vm.error()).toBe(OUTDATED));
  });

  it('pas un espace Nx : message du daemon, pas de graphe', async () => {
    const { vm, host } = await setup({ info: new Error('Pas un espace Nx') });
    expect(vm.error()).toBe('Pas un espace Nx');
    expect(host.call).toHaveBeenCalledTimes(1);
  });

  it('thèmes par nature sur le nom de la cible ; projet:cible visible ; cible non lançable avec sa raison', async () => {
    const { vm } = await setup();
    await vi.waitFor(() => expect(vm.projects()).toHaveLength(2));
    expect(vm.themes().map((t) => [t.label, t.tasks.map((x) => x.name)])).toEqual([
      ['Développement', ['api:serve']],
      ['Build', ['api:build']],
      ['Tests', ['ui-kit:test']],
      ['Qualité', ['ui-kit:lint:fix']],
    ]);
    expect(vm.themes()[1].tasks[0]).toMatchObject({ id: 'api:build', hint: 'app · Construit l’API', command: 'vite build', disabledReason: null, keywords: ['app', 'apps/api'] });
    expect(vm.themes()[3].tasks[0].disabledReason).toBe(NOT_RUNNABLE);
    expect(vm.storageKey()).toMatch(/^nx:/);
  });

  it('Rafraîchir relit info puis le graphe', async () => {
    const { vm, host } = await setup();
    await vi.waitFor(() => expect(vm.projects()).toHaveLength(2));
    vm.refresh();
    await vi.waitFor(() => { TestBed.tick(); expect(host.call).toHaveBeenCalledTimes(4); });
  });

  it('Rafraîchir rapide ou onglet quitté : le graphe en cours est abandonné, sans erreur affichée', async () => {
    const call = callReplies({ info: anInfo(), graph: new Promise(() => undefined) }); // nx graph ne répond jamais
    TestBed.configureTestingModule({ providers: [NxVm, { provide: PluginHost, useValue: fakePluginHost({ sessionId: signal(`nx-${++n}`), call }) }] });
    const vm = TestBed.inject(NxVm);
    const graphs = () => vi.mocked(call).mock.calls.filter((c) => c[0] === 'graph').map((c) => c[3]!.signal!);
    await vi.waitFor(() => { TestBed.tick(); expect(graphs()).toHaveLength(1); });
    vm.refresh();
    vm.refresh();
    await vi.waitFor(() => { TestBed.tick(); expect(graphs().length).toBeGreaterThan(1); });
    // Un seul appel vivant : les précédents sont annulés, pas empilés.
    expect(graphs().map((s) => s.aborted)).toEqual([...graphs().slice(1).map(() => true), false]);
    expect([vm.error(), vm.loadingGraph()]).toEqual([null, true]);
    TestBed.resetTestingModule(); // l'onglet est quitté : le VM est détruit
    expect(graphs().at(-1)!.aborted).toBe(true);
  });

  it('lance nx run projet:cible, un lancement à la fois, erreur du daemon affichée', async () => {
    let reject!: (e: Error) => void;
    const terminal = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    const { vm } = await setup({}, { terminal });
    const pending = vm.run({ id: 'api:build' });
    expect(terminal).toHaveBeenCalledWith('run', { project: 'api', target: 'build' });
    expect(vm.launching()).toBe('api:build');
    await vm.run({ id: 'api:serve' }); // ignorée
    expect(terminal).toHaveBeenCalledTimes(1);
    reject(new Error('Cible invalide'));
    await pending;
    expect([vm.launchError(), vm.launching()]).toEqual(['Cible invalide', null]);
  });
});

describe('NxTabComponent', () => {
  async function render(replies: Record<string, unknown>, ready: string) {
    const host = fakePluginHost({ sessionId: signal(`nx-${++n}`), call: callReplies({ info: anInfo(), graph: aGraph(), ...replies }) });
    TestBed.configureTestingModule({ providers: [{ provide: PluginHost, useValue: host }] });
    const fixture = TestBed.createComponent(NxTabComponent);
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => { fixture.detectChanges(); expect(el.querySelector(ready)).not.toBeNull(); });
    return el;
  }

  it('graphe tronqué : « Liste incomplète » dans l’encadré neutre, cibles lues affichées', async () => {
    const el = await render({ graph: aGraph({ truncated: true }) }, '.theme');
    expect(el.querySelector('.notes')?.textContent).toContain('Liste incomplète');
    expect(el.querySelectorAll('.theme')).toHaveLength(4);
  });

  it('télémétrie : explication, pas d’erreur ni d’état vide', async () => {
    const el = await render({ info: anInfo({ telemetry: true }) }, '.notes p');
    expect(el.querySelector('.notes')!.textContent).toContain('Télémétrie Nx activée');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).not.toContain('Aucune cible');
  });

  it('cible non lançable : bouton aria-disabled avec sa raison, jamais disabled', async () => {
    const el = await render({}, '.theme');
    const go = [...el.querySelectorAll<HTMLButtonElement>('button.go')];
    expect(go.map((b) => b.getAttribute('aria-label'))).toEqual(['Lancer api:serve', 'Lancer api:build', 'Lancer ui-kit:test', 'Lancer ui-kit:lint:fix']);
    expect(go.map((b) => b.getAttribute('aria-disabled'))).toEqual([null, null, null, 'true']);
    expect(go.some((b) => b.disabled)).toBe(false);
    expect(el.querySelector('#' + go[3].getAttribute('aria-describedby'))!.textContent).toBe(NOT_RUNNABLE);
    expect(el.textContent).toContain('nx du dépôt');
  });
});
