import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OUTDATED, PluginHost } from '@vigie/plugin-sdk';
import { callReplies, fakePluginHost } from '@vigie/plugin-sdk/testing';
import { NpmProject as NpmProjectSchema } from '../contract.mjs';
import NpmTabComponent from './index';
import type { NpmProject } from './models';
import { NpmVm, npmThemes } from './npm.vm';

const aProject = (over: Partial<NpmProject> = {}): NpmProject => ({
  pm: 'pnpm', from: 'pnpm-lock.yaml', warning: null, truncated: false, error: null,
  scripts: [{ name: 'build', command: 'ng build' }, { name: 'test', command: 'vitest' }],
  workspaces: [{ name: '@app/api', dir: 'packages/api', scripts: [{ name: 'start', command: 'node server.mjs' }] }],
  ...over,
});

async function setup(project: unknown = aProject(), over: Partial<PluginHost> = {}) {
  const host = fakePluginHost({ call: callReplies({ project }), ...over });
  TestBed.configureTestingModule({ providers: [NpmVm, { provide: PluginHost, useValue: host }] });
  const vm = TestBed.inject(NpmVm);
  await vi.waitFor(() => expect(vm.loading()).toBe(false));
  return { vm, host };
}

describe('NpmVm', () => {
  it('la réponse factice respecte le contrat du plugin', () => {
    expect(NpmProjectSchema.safeParse(aProject()).success).toBe(true);
  });

  it('lit le projet par la méthode « project » : gestionnaire et thèmes par nature, racine puis workspaces', async () => {
    const { vm, host } = await setup();
    expect(host.call).toHaveBeenCalledWith('project', {}, NpmProjectSchema, { signal: expect.any(AbortSignal) });
    expect(vm.manager()).toBe('pnpm · pnpm-lock.yaml');
    expect(vm.storageKey()).toBe('npm:/dev/app');
    expect(vm.themes().map((t) => [t.label, t.tasks.map((x) => [x.scope, x.name])])).toEqual([
      ['Développement', [['@app/api', 'start']]],
      ['Build', [[null, 'build']]],
      ['Tests', [[null, 'test']]],
    ]);
    expect(vm.themes()[0].tasks[0]).toMatchObject({ command: 'node server.mjs', keywords: ['packages/api'] });
  });

  it('crochets pre/post et prepare : thème « Cycle de vie » ; mêmes thèmes pour tous les workspaces', () => {
    const themes = npmThemes(aProject({
      scripts: [{ name: 'prebuild', command: 'rm -rf dist' }, { name: 'build', command: 'tsc' }, { name: 'prepare', command: 'husky' }, { name: 'pretty', command: 'x' }],
      workspaces: [{ name: 'w', dir: 'packages/w', scripts: [{ name: 'build', command: 'vite build' }] }],
    }));
    expect(themes.map((t) => [t.id, t.tasks.map((x) => `${x.scope ?? '.'}/${x.name}`)])).toEqual([
      ['build', ['./build', 'w/build']],
      ['lifecycle', ['./prebuild', './prepare']],
      ['other', ['./pretty']],
    ]);
  });

  it('package.json absent : message du back, pas de gestionnaire', async () => {
    const { vm } = await setup(aProject({ scripts: [], workspaces: [], error: 'package.json introuvable' }));
    expect([vm.error(), vm.manager(), vm.themes()]).toEqual(['package.json introuvable', null, []]);
  });

  it('réponse hors contrat : message « daemon à jour ? »', async () => {
    const { vm } = await setup({ pm: 'npm' });
    expect([vm.error(), vm.themes()]).toEqual([OUTDATED, []]);
  });

  it('Rafraîchir relit le projet', async () => {
    const { vm, host } = await setup();
    vm.refresh();
    await vi.waitFor(() => expect(host.call).toHaveBeenCalledTimes(2));
  });

  it('lance un script de la racine (workspace null) ou d’un workspace', async () => {
    const { vm, host } = await setup();
    await vm.run({ id: 'b', name: 'build', scope: null });
    expect(host.terminal).toHaveBeenCalledWith('run', { script: 'build', workspace: null });
    await vm.run({ id: 's', name: 'start', scope: '@app/api' });
    expect(host.terminal).toHaveBeenLastCalledWith('run', { script: 'start', workspace: '@app/api' });
  });

  it('script refusé : message du daemon, un lancement à la fois', async () => {
    let reject!: (e: Error) => void;
    const terminal = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    const { vm } = await setup(aProject(), { terminal });
    const pending = vm.run({ id: 'b', name: 'build' });
    expect(vm.launching()).toBe('b');
    await vm.run({ id: 't', name: 'test' }); // ignorée
    expect(terminal).toHaveBeenCalledTimes(1);
    reject(new Error('Script inconnu'));
    await pending;
    expect([vm.error(), vm.launching()]).toEqual(['Script inconnu', null]);
  });
});

describe('NpmTabComponent', () => {
  it('provenance, avertissements dans l’encadré neutre, panneaux par nature, libellés avec le workspace', async () => {
    const host = fakePluginHost({ call: callReplies({ project: aProject({ warning: 'packageManager (pnpm) en désaccord avec yarn', truncated: true }) }) });
    TestBed.configureTestingModule({ providers: [{ provide: PluginHost, useValue: host }] });
    const fixture = TestBed.createComponent(NpmTabComponent);
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => { fixture.detectChanges(); expect(el.querySelector('.theme')).not.toBeNull(); });
    expect(el.querySelector('.bar')!.textContent).toContain('pnpm · pnpm-lock.yaml');
    expect(el.querySelector('h2')!.textContent).toBe('Scripts npm');
    expect(el.querySelector('.notes')!.textContent).toContain('en désaccord avec yarn');
    expect(el.querySelector('.notes')!.textContent).toContain('Liste incomplète');
    expect([...el.querySelectorAll('.toggle .label')].map((h) => h.textContent)).toEqual(['Développement', 'Build', 'Tests']);
    expect([...el.querySelectorAll('button.go')].map((b) => b.getAttribute('aria-label'))).toEqual(['Lancer start dans @app/api', 'Lancer build', 'Lancer test']);
  });
});
