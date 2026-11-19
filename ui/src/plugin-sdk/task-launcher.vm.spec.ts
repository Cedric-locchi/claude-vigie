import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskLauncherVm, isSearchShortcut, natureOf, natureThemes, type LauncherTask, type TaskTheme } from './task-launcher.vm';

const t = (id: string, over: Partial<LauncherTask> = {}): LauncherTask => ({ id, name: id, ...over });
const THEMES: TaskTheme[] = [
  { id: 'dev', label: 'Développement', tasks: [t('dev', { command: 'vite' }), t('start', { scope: '@app/api', hint: 'Démarre l’API' })] },
  { id: 'lifecycle', label: 'Cycle de vie', tasks: [t('prepare', { command: 'husky' })] },
  { id: 'other', label: 'Autres', tasks: [t('lint:fix', { disabledReason: 'Non lançable' }), t('clean', { keywords: ['rimraf'] })] },
];

function setup(over: { key?: string; launching?: string | null } = {}) {
  TestBed.configureTestingModule({ providers: [TaskLauncherVm] });
  const vm = TestBed.inject(TaskLauncherVm);
  const run = vi.fn();
  const launching = signal<string | null>(over.launching ?? null);
  const key = signal(over.key ?? 'npm:/dev/app');
  vm.connect({ themes: signal(THEMES), launching, storageKey: key, run });
  return { vm, run, launching, key };
}
const state = (vm: TaskLauncherVm) => [vm.current()?.id, vm.visible().map((th) => [th.id, th.tasks.map((x) => x.id)])];

afterEach(() => localStorage.clear());

describe('TaskLauncherVm', () => {
  it('premier thème par défaut ; le thème choisi est mémorisé par clé (plugin + dossier)', () => {
    let { vm } = setup();
    expect(vm.current()?.id).toBe('dev');
    vm.select('other');
    expect(vm.current()?.id).toBe('other');
    TestBed.resetTestingModule();
    ({ vm } = setup());
    expect(vm.current()?.id).toBe('other');
    TestBed.resetTestingModule();
    ({ vm } = setup({ key: 'npm:/autre' }));
    expect(vm.current()?.id).toBe('dev');
  });

  it('stockage bloqué ou thème disparu : premier thème, sans erreur', () => {
    localStorage.setItem('vigie.launcher.theme.npm:/dev/app', 'parti');
    const { vm } = setup();
    expect(vm.current()?.id).toBe('dev');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => vm.select('lifecycle')).not.toThrow();
    expect(vm.current()?.id).toBe('lifecycle');
    set.mockRestore();
  });

  it('recherche : nom, workspace, indication, commande, mots-clés, thème ; le thème choisi reste s’il a des résultats', () => {
    const { vm } = setup();
    vm.select('other');
    vm.search.set('HUSKY');
    expect(state(vm)).toEqual(['lifecycle', [['lifecycle', ['prepare']]]]);
    vm.search.set('api');
    expect(state(vm)).toEqual(['dev', [['dev', ['start']]]]);
    vm.search.set('rimraf');
    expect(state(vm)).toEqual(['other', [['other', ['clean']]]]);
    vm.search.set('cycle');
    expect(state(vm)).toEqual(['lifecycle', [['lifecycle', ['prepare']]]]);
    vm.search.set('zzz');
    expect(state(vm)).toEqual([undefined, []]);
    vm.search.set('');
    expect(vm.current()?.id).toBe('other');
  });

  it('« Entrée » lance la première tâche lançable du thème affiché', () => {
    const { vm, run } = setup();
    vm.search.set('lint');
    expect(vm.first()).toBeNull(); // lint:fix non lançable
    vm.search.set('');
    vm.select('other');
    expect(vm.first()?.task.id).toBe('clean');
    vm.runFirst();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'clean' }));
  });

  it('garde-fou : rien pendant un lancement, rien pour une tâche non lançable', () => {
    const { vm, run, launching } = setup({ launching: 'dev' });
    vm.run(THEMES[0].tasks[1]);
    launching.set(null);
    vm.run(THEMES[2].tasks[0]);
    expect(run).not.toHaveBeenCalled();
    vm.run(THEMES[0].tasks[1]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('libellé accessible et infobulle', () => {
    const { vm } = setup();
    expect(vm.label(THEMES[0].tasks[1])).toBe('Lancer start dans @app/api');
    expect(vm.title({ ...THEMES[0].tasks[1], command: 'node api' })).toBe('Démarre l’API\nnode api');
  });
});

describe('isSearchShortcut', () => {
  const key = (k: string, target: Element, over: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, ...over });
    Object.defineProperty(e, 'target', { value: target });
    return e;
  };
  it('« / » hors d’un champ seulement', () => {
    expect(isSearchShortcut(key('/', document.body))).toBe(true);
    expect(isSearchShortcut(key('/', document.createElement('textarea')))).toBe(false);
    expect(isSearchShortcut(key('/', document.createElement('input')))).toBe(false);
    expect(isSearchShortcut(key('/', document.body, { ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key('a', document.body))).toBe(false);
  });
});

describe('natureOf / natureThemes', () => {
  const none = new Set<string>();
  it('déduit la nature du nom', () => {
    const cases: [string, string][] = [
      ['dev', 'dev'], ['start:prod', 'dev'], ['serve-static', 'dev'], ['watch', 'dev'],
      ['build', 'build'], ['build:ui', 'build'], ['compile', 'build'], ['bundle', 'build'], ['dist', 'build'],
      ['test', 'test'], ['test:unit', 'test'], ['e2e', 'test'], ['coverage', 'test'],
      ['lint', 'quality'], ['lint:fix', 'quality'], ['format', 'quality'], ['typecheck', 'quality'], ['check-types', 'quality'],
      ['release', 'publish'], ['publish', 'publish'], ['deploy:prod', 'publish'], ['version', 'publish'],
      ['prepare', 'lifecycle'], ['postinstall', 'lifecycle'], ['clean', 'other'], ['prettier', 'other'],
    ];
    expect(cases.map(([n]) => [n, natureOf(n, none)])).toEqual(cases);
  });
  it('pre/post : cycle de vie seulement si le script de base existe', () => {
    expect(natureOf('prebuild', new Set(['build']))).toBe('lifecycle');
    expect(natureOf('posttest', new Set(['test']))).toBe('lifecycle');
    expect(natureOf('prebuild', none)).toBe('other');
  });
  it('ordre fixe des thèmes, thèmes vides retirés, ordre reçu dans un thème', () => {
    const items = ['test', 'dev', 'test:e2e'].map((name) => ({ name, siblings: none, task: t(name) }));
    expect(natureThemes(items).map((th) => [th.label, th.tasks.map((x) => x.id)])).toEqual([['Développement', ['dev']], ['Tests', ['test', 'test:e2e']]]);
  });
});
