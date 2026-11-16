import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { MiseTasks } from '../../../core/models';
import { VigieService } from '../../../core/vigie.service';
import { aMiseTasks, aTerminal, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionMiseVm, hasMise, sectorOf } from './session-mise.vm';

function setup(mise: MiseTasks | null = aMiseTasks(), openShell = vi.fn(async () => aTerminal({ id: 't9', kind: 'shell' }))) {
  TestBed.configureTestingModule({ providers: [SessionMiseVm, provideVigieServiceMock({ openShell: openShell as unknown as VigieService['openShell'] })] });
  const vm = TestBed.inject(SessionMiseVm);
  const opened = vi.fn();
  vm.connect(signal('s1'), signal(mise), opened);
  return { vm, opened, openShell };
}

describe('hasMise', () => {
  it("n'existe que si mise est installé et que le projet a des tâches ou un message", () => {
    expect(hasMise(aMiseTasks())).toBe(true);
    expect(hasMise(aMiseTasks({ available: false }))).toBe(false);
    expect(hasMise(aMiseTasks({ tasks: aMiseTasks().tasks.filter((t) => t.global) }))).toBe(false); // globales seulement
    expect(hasMise(aMiseTasks({ tasks: [], untrusted: true, error: 'Config files are not trusted.' }))).toBe(true);
    expect(hasMise(null)).toBe(false);
  });
});

describe('sectorOf', () => {
  it('prend le préfixe « : », sinon le dossier du mise.toml, sinon le projet', () => {
    expect(sectorOf({ name: 'front:build', source: 'mise.toml' })).toEqual({ sector: 'front', short: 'build' });
    expect(sectorOf({ name: 'build', source: 'ui/mise.toml' })).toEqual({ sector: 'ui', short: 'build' });
    expect(sectorOf({ name: 'build', source: '.mise/tasks/build' })).toEqual({ sector: 'Projet', short: 'build' });
    expect(sectorOf({ name: 'build', source: 'mise.toml' })).toEqual({ sector: 'Projet', short: 'build' });
  });
});

describe('SessionMiseVm secteurs', () => {
  const task = (name: string, aliases: string[] = []) => ({ name, aliases, description: 'x', source: 'mise.toml', depends: [], run: ['x'], file: null, global: false });
  it('groupe par secteur (Projet d’abord) et filtre sur le nom ou un alias', () => {
    const { vm } = setup(aMiseTasks({ tasks: [task('back:test'), task('front:build', ['fb']), task('lint'), task('back:build')] }));
    expect(vm.sectors().map((s) => [s.name, s.tasks.map((t) => t.short)])).toEqual([['Projet', ['lint']], ['back', ['build', 'test']], ['front', ['build']]]);
    vm.search.set('FB');
    expect(vm.sectors().map((s) => s.name)).toEqual(['front']);
    vm.search.set('zzz');
    expect(vm.sectors()).toEqual([]);
    expect(vm.first()).toBeNull();
  });

  it('montre ce que la tâche exécute et cherche aussi dans la description', () => {
    const t = { ...task('front:build'), description: 'Construit l’UI', run: ['ng build', 'echo ok'], depends: ['lint'] };
    const { vm } = setup(aMiseTasks({ tasks: [t, task('lint')] }));
    vm.search.set('construit');
    expect(vm.first()).toMatchObject({ name: 'front:build', short: 'build', command: 'ng build', extra: 1, depends: ['lint'] });
  });
});

describe('SessionMiseVm', () => {
  it('ne montre que les tâches du projet', () => {
    const { vm } = setup();
    expect(vm.tasks().map((t) => t.name)).toEqual(['test']);
    expect([vm.untrusted(), vm.error()]).toEqual([false, null]);
  });

  it('lance une tâche dans un nouveau terminal et le fait afficher', async () => {
    const { vm, opened, openShell } = setup();
    await vm.run('test');
    expect(openShell).toHaveBeenCalledWith('s1', { miseTask: 'test' });
    expect(opened).toHaveBeenCalledWith('t9');
    expect([vm.launching(), vm.launchError()]).toEqual([false, null]);
  });

  it('config non approuvée : mise trust dans un terminal', async () => {
    const { vm, opened, openShell } = setup(aMiseTasks({ tasks: [], untrusted: true, error: 'Config files are not trusted.' }));
    expect([vm.untrusted(), vm.error()]).toEqual([true, 'Config files are not trusted.']);
    await vm.trust();
    expect(openShell).toHaveBeenCalledWith('s1', { miseTrust: true });
    expect(opened).toHaveBeenCalledWith('t9');
  });

  it('tâche refusée (400) : message du daemon, pas de terminal', async () => {
    const openShell = vi.fn(async () => { throw Object.assign(new Error('http'), { status: 400, error: { error: 'Tâche mise inconnue : test' } }); });
    const { vm, opened } = setup(aMiseTasks(), openShell as never);
    await vm.run('test');
    expect(vm.launchError()).toBe('Tâche mise inconnue : test');
    expect(opened).not.toHaveBeenCalled();
    expect(vm.launching()).toBe(false);
  });
});
