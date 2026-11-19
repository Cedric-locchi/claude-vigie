import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { OUTDATED, PluginHost } from '@vigie/plugin-sdk';
import { callReplies, fakePluginHost } from '@vigie/plugin-sdk/testing';
import { MiseTasks as MiseTasksSchema } from '../contract.mjs';
import MiseTabComponent from './index';
import { MISE_MISSING, MiseVm, miseThemes, sectorOf } from './mise.vm';
import type { MiseTasks } from './models';

const task = (name: string, over: Partial<MiseTasks['tasks'][number]> = {}) =>
  ({ name, aliases: [], description: 'x', source: 'mise.toml', depends: [], run: ['x'], file: null, global: false, ...over });
const aMise = (over: Partial<MiseTasks> = {}): MiseTasks =>
  ({ available: true, untrusted: false, error: null, tasks: [task('test'), task('fmt', { global: true, source: '~/.config/mise/config.toml' })], ...over });

async function setup(mise: unknown = aMise(), over: Partial<PluginHost> = {}) {
  const host = fakePluginHost({ call: callReplies({ tasks: mise }), ...over });
  TestBed.configureTestingModule({ providers: [MiseVm, { provide: PluginHost, useValue: host }] });
  const vm = TestBed.inject(MiseVm);
  await vi.waitFor(() => expect(vm.loading()).toBe(false));
  return { vm, host, call: host.call };
}

describe('sectorOf', () => {
  it('prend le préfixe « : », sinon le dossier du mise.toml, sinon le projet', () => {
    expect(sectorOf({ name: 'front:build', source: 'mise.toml' })).toEqual({ sector: 'front', short: 'build' });
    expect(sectorOf({ name: 'build', source: 'ui/mise.toml' })).toEqual({ sector: 'ui', short: 'build' });
    expect(sectorOf({ name: 'build', source: '.mise/tasks/build' })).toEqual({ sector: 'Projet', short: 'build' });
    expect(sectorOf({ name: 'build', source: 'mise.toml' })).toEqual({ sector: 'Projet', short: 'build' });
  });
});

describe('miseThemes', () => {
  it('un thème par secteur (Projet d’abord), tâches triées par nom court ; alias et dépendances cherchables', () => {
    const themes = miseThemes([task('back:test'), task('front:build', { aliases: ['fb'], depends: ['lint'], run: ['ng build', 'echo ok'] }), task('lint', { description: '' }), task('back:build')]);
    expect(themes.map((t) => [t.label, t.tasks.map((x) => x.name)])).toEqual([['Projet', ['lint']], ['back', ['build', 'test']], ['front', ['build']]]);
    expect(themes[2].tasks[0]).toEqual({ id: 'front:build', name: 'build', hint: 'x', command: 'ng build && echo ok', keywords: ['front:build', 'fb', 'lint'] });
    expect(themes[0].tasks[0].hint).toBeNull();
  });
});

describe('MiseVm', () => {
  it('la réponse factice respecte le contrat du plugin', () => {
    expect(MiseTasksSchema.safeParse(aMise()).success).toBe(true);
  });

  it('mise absent (projet qui déclare des tâches) : message clair, aucune tâche', async () => {
    const { vm } = await setup(aMise({ available: false, tasks: [] }));
    expect([vm.missing(), vm.notice(), vm.error(), vm.tasks(), vm.untrusted()]).toEqual([true, null, null, [], false]);
  });

  it('lit les tâches par la méthode « tasks » et ne montre que celles du projet', async () => {
    const { vm, call } = await setup();
    expect(call).toHaveBeenCalledWith('tasks', {}, MiseTasksSchema, { signal: expect.any(AbortSignal) });
    expect(vm.tasks().map((t) => t.name)).toEqual(['test']);
    expect(vm.themes().map((t) => t.label)).toEqual(['Projet']);
    expect(vm.storageKey()).toBe('mise:/dev/app');
    expect([vm.untrusted(), vm.notice(), vm.error()]).toEqual([false, null, null]);
  });

  it('Rafraîchir relit la liste', async () => {
    const { vm, call } = await setup();
    vm.refresh();
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  });

  it('réponse hors contrat : message « daemon à jour ? », pas de tâche', async () => {
    const { vm } = await setup({ tasks: 'nope' });
    expect([vm.error(), vm.tasks()]).toEqual([OUTDATED, []]);
  });

  it('lance une tâche dans un terminal du plugin', async () => {
    const { vm, host } = await setup();
    await vm.run({ id: 'test' });
    expect(host.terminal).toHaveBeenCalledWith('run', { task: 'test' });
    expect([vm.launching(), vm.launchError()]).toEqual([null, null]);
    expect(host.refresh).not.toHaveBeenCalled();
  });

  it('config non approuvée : mise trust dans un terminal, puis les onglets sont relus', async () => {
    const { vm, host } = await setup(aMise({ tasks: [], untrusted: true, error: 'Config files are not trusted.' }));
    expect([vm.untrusted(), vm.notice(), vm.error()]).toEqual([true, 'Config files are not trusted.', null]);
    await vm.trust();
    expect(host.terminal).toHaveBeenCalledWith('trust');
    expect(host.refresh).toHaveBeenCalled();
  });

  it('tâche refusée : message du daemon, un lancement à la fois', async () => {
    let reject!: (e: Error) => void;
    const terminal = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
    const { vm } = await setup(aMise(), { terminal });
    const pending = vm.run({ id: 'test' });
    expect(vm.launching()).toBe('test');
    await vm.run({ id: 'test' }); // ignorée
    expect(terminal).toHaveBeenCalledTimes(1);
    reject(new Error('Tâche mise inconnue'));
    await pending;
    expect([vm.error(), vm.launching()]).toEqual(['Tâche mise inconnue', null]);
  });
});

describe('MiseTabComponent', () => {
  async function render(mise: unknown, ready: string) {
    const host = fakePluginHost({ call: callReplies({ tasks: mise }) });
    TestBed.configureTestingModule({ providers: [{ provide: PluginHost, useValue: host }] });
    const fixture = TestBed.createComponent(MiseTabComponent);
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => { fixture.detectChanges(); expect(el.querySelector(ready)).not.toBeNull(); });
    return { el, host, fixture };
  }

  it('un thème par secteur dans la navigation, un bouton « Lancer » par tâche du thème choisi', async () => {
    const { el, host, fixture } = await render(aMise({ tasks: [task('front:build'), task('lint')] }), '.nav-item');
    const nav = [...el.querySelectorAll<HTMLButtonElement>('.nav-item')];
    expect(nav.map((b) => b.querySelector('.label')!.textContent)).toEqual(['Projet', 'front']);
    const go = () => [...el.querySelectorAll<HTMLButtonElement>('button.go')];
    expect(go().map((b) => b.getAttribute('aria-label'))).toEqual(['Lancer lint']);
    nav[1].click();
    fixture.detectChanges();
    expect(go().map((b) => b.getAttribute('aria-label'))).toEqual(['Lancer build']);
    go()[0].click();
    expect(host.terminal).toHaveBeenCalledWith('run', { task: 'front:build' });
    localStorage.clear();
  });

  it('config non approuvée : sortie de mise dans l’encadré et bouton mise trust, pas d’état vide', async () => {
    const { el } = await render(aMise({ tasks: [], untrusted: true, error: 'Config files are not trusted.' }), '.notes p');
    expect(el.querySelector('.notes')!.textContent).toContain('Config files are not trusted.');
    expect(el.querySelector('.notes button')!.textContent).toContain('mise trust');
    expect(el.textContent).not.toContain('Aucune tâche mise');
  });

  it('mise absent : message clair', async () => {
    const { el } = await render(aMise({ available: false, tasks: [] }), '.notes p');
    expect(el.querySelector('.notes')!.textContent).toContain(MISE_MISSING);
  });
});
