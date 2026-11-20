import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aTerminal, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { CLIENT_OS, ClientOs } from '../../core/platform';
import { NewSessionVm, ago, buildCommand, fuzzy } from './new-session.vm';

function createVm(startSession = vi.fn(async () => aTerminal()), os: ClientOs = 'mac') {
  TestBed.configureTestingModule({
    providers: [NewSessionVm, { provide: CLIENT_OS, useValue: os }, provideRouter([]), provideVigieServiceMock({ startSession })],
  });
  const vm = TestBed.inject(NewSessionVm);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { vm, startSession, navigate };
}

describe('buildCommand', () => {
  it('compose la commande depuis les options', () => {
    expect(buildCommand({ model: 'opus', permission: 'default', git: 'current', template: '' })).toBe('claude --model opus');
    expect(buildCommand({ model: 'sonnet', permission: 'plan', git: 'worktree', template: '' })).toBe('claude --model sonnet --permission-mode plan --worktree');
    expect(buildCommand({ model: 'opus', permission: 'default', git: 'current', template: '', name: " Refonte d'auth " })).toBe("claude --model opus --name 'Refonte d'\\''auth'");
    expect(buildCommand({ model: 'opus', permission: 'default', git: 'current', template: 'bug' })).toMatch(/^claude --model opus 'Je vais te décrire un bug\. Reproduis-le d'\\''abord/);
    expect(buildCommand({ model: 'opus', permission: 'default', git: 'worktree', branch: 'auth', template: '' })).toBe("claude --model opus --worktree 'auth'");
    expect(buildCommand({ model: 'opus', permission: 'default', git: 'branch', branch: 'feat/x', template: '' })).toBe("git switch -c 'feat/x' && claude --model opus");
    expect(buildCommand({ model: 'opus', permission: 'default', git: 'branch', branch: ' ', template: '' })).toBe('claude --model opus');
  });
});

describe('ago', () => {
  it("écrit l'ancienneté", () => {
    expect(ago(20_000)).toBe("à l'instant");
    expect(ago(12 * 60_000)).toBe('il y a 12 min');
    expect(ago(2.5 * 3_600_000)).toBe('il y a 2 h');
    expect(ago(3 * 86_400_000)).toBe('il y a 3 j');
    expect(ago(65 * 86_400_000)).toBe('il y a 2 mois');
    expect(ago(400 * 86_400_000)).toBe('il y a 1 an');
  });

});

describe('fuzzy', () => {
  it('sous-chaîne d\'abord, sinon lettres dans l\'ordre', () => {
    expect(fuzzy('meeplebox', 'PLE')).toEqual([3, 4, 5]);
    expect(fuzzy('meeplebox', 'mbx')).toEqual([0, 6, 8]);
    expect(fuzzy('meeplebox', 'xm')).toBeNull();
  });
});

const names = (vm: NewSessionVm) => vm.rows().map((p) => p.path);
const key = (vm: NewSessionVm, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, cancelable: true, ...init });
  vm.dirKey(e);
  return e.defaultPrevented;
};

describe('NewSessionVm : sélecteur de dossier', () => {
  afterEach(() => vi.useRealTimers());

  it('filtre les récents côté client, le nom avant le chemin, sans requête', () => {
    const { vm } = createVm();
    expect(names(vm)).toEqual(['~/dev/meeplebox', '~/dev/vigie', '~/dev/vigie/ui', '~/notes']);
    vm.setQuery('vi');
    expect(names(vm)).toEqual(['~/dev/vigie', '~/dev/vigie/ui']); // « vigie » par son nom, « ui » par son chemin
    vm.setQuery('ui');
    expect(names(vm)).toEqual(['~/dev/vigie/ui']);
    vm.setQuery('mpb');
    expect(names(vm)).toEqual(['~/dev/meeplebox']);
    expect(vm.parts('meeplebox')).toEqual([{ text: 'm', hit: true }, { text: 'ee', hit: false }, { text: 'p', hit: true }, { text: 'le', hit: false }, { text: 'b', hit: true }, { text: 'ox', hit: false }]);
    vm.setQuery('zzz');
    expect(names(vm)).toEqual([]);
    expect(vm.emptyText()).toContain('Aucun dossier récent ne correspond');
  });

  it('un chemin interroge le daemon après 150 ms et garde la liste précédente en attendant', async () => {
    vi.useFakeTimers();
    const { vm } = createVm();
    expect(names(vm)).toHaveLength(4); // liste déjà affichée avant la frappe
    TestBed.tick();
    vm.setQuery('~/dev/');
    TestBed.tick();
    expect(names(vm)).toEqual(['~/dev/meeplebox', '~/dev/vigie', '~/dev/vigie/ui', '~/notes']); // pas de clignotement
    await vi.advanceTimersByTimeAsync(150);
    TestBed.tick();
    expect(names(vm)).toEqual(['~/dev/meeplebox', '~/dev/vigie']);
    expect(vm.crumbs()).toEqual([{ label: '~', path: '~/' }, { label: 'dev', path: '~/dev/' }]);
    vm.setQuery('~/dev/vi');
    await vi.advanceTimersByTimeAsync(150);
    TestBed.tick();
    expect(names(vm)).toEqual(['~/dev/vigie']);
    expect(vm.parts('vigie')[0]).toEqual({ text: 'vi', hit: true });
    vm.setQuery('~/dev/zz');
    await vi.advanceTimersByTimeAsync(150);
    TestBed.tick();
    expect(vm.emptyText()).toBe('Aucun sous-dossier ne commence par « zz » : le chemin tapé sera utilisé.');
  });

  it('le texte tapé reste le dossier ; choisir une ligne fixe cwd', () => {
    const { vm } = createVm();
    expect(vm.chosen()).toBe('~/dev/meeplebox'); // champ vide : le plus récent
    vm.setQuery('~/ailleurs');
    expect(vm.model().cwd).toBe('~/ailleurs');
    vm.setQuery('vigie');
    vm.select(vm.rows()[0]);
    expect(vm.model().cwd).toBe('~/dev/vigie');
    expect(vm.query()).toBe('vigie');
  });

  it('clavier : flèches, Entrée, Tab et → parcourent, ← et Retour arrière remontent', () => {
    const { vm } = createVm();
    expect(vm.activeId()).toBe('ns-dir-opt-0');
    expect(key(vm, 'ArrowUp')).toBe(true);
    expect(vm.active()).toBe(3); // boucle
    key(vm, 'ArrowDown');
    key(vm, 'ArrowDown');
    expect(vm.active()).toBe(1);
    expect(key(vm, 'Enter')).toBe(true);
    expect(vm.model().cwd).toBe('~/dev/vigie');
    expect(key(vm, 'Tab')).toBe(false); // champ vide : Tab sort du champ
    vm.setQuery('vig');
    expect(key(vm, 'Tab')).toBe(true);
    expect(vm.query()).toBe('~/dev/vigie/');
    expect(vm.model().cwd).toBe('~/dev/vigie/');
    expect(key(vm, 'Backspace')).toBe(true);
    expect(vm.query()).toBe('~/dev/');
    expect(key(vm, 'ArrowLeft')).toBe(true);
    expect(vm.query()).toBe('~/');
    key(vm, 'ArrowLeft');
    expect(vm.query()).toBe(''); // au-dessus de ~/ : retour aux récents
    expect(key(vm, 'ArrowLeft')).toBe(false);
    vm.setQuery('notes');
    expect(key(vm, 'ArrowRight')).toBe(true);
    expect(vm.query()).toBe('~/notes/');
    expect(key(vm, 'Enter', { metaKey: true })).toBe(false); // lancement : laissé au formulaire
  });
});

describe('NewSessionVm', () => {
  it('recalcule la commande quand une option change, mais garde une saisie manuelle', () => {
    const { vm } = createVm();
    vm.model.update((m) => ({ ...m, model: 'haiku' }));
    expect(vm.command()).toBe('claude --model haiku');
    vm.setCommand('claude --resume abc');
    expect(vm.command()).toBe('claude --resume abc');
  });

  it('lance la session dans le dossier récent par défaut puis ouvre sa page', async () => {
    const { vm, startSession, navigate } = createVm();
    await vm.launch();
    expect(startSession).toHaveBeenCalledWith({ cwd: '~/dev/meeplebox', command: 'claude --model opus' });
    expect(navigate).toHaveBeenCalledWith(['/sessions', 's1']);
  });

  it('exige un nom de branche en mode nouvelle branche', async () => {
    const { vm, startSession } = createVm();
    vm.setGit('branch');
    await vm.launch();
    expect(startSession).not.toHaveBeenCalled();
    vm.model.update((m) => ({ ...m, branch: 'feat/x' }));
    await vm.launch();
    expect(startSession).toHaveBeenCalledWith({ cwd: '~/dev/meeplebox', command: "git switch -c 'feat/x' && claude --model opus" });
  });

  it("affiche l'erreur du daemon", async () => {
    const { vm } = createVm(vi.fn(async () => { throw { error: { error: 'Dossier introuvable : ~/x' } }; }));
    vm.model.update((m) => ({ ...m, cwd: '~/x' }));
    await vm.launch();
    expect(vm.error()).toBe('Dossier introuvable : ~/x');
    expect(vm.form().submitting()).toBe(false);
  });

  it("attache chaque erreur du schéma à son champ, avec le message affiché", () => {
    const { vm } = createVm();
    vm.model.update((m) => ({ ...m, cwd: '', git: 'branch' }));
    expect(vm.form.cwd().errors().map((e) => e.message)).toEqual(['Choisis un dossier']);
    expect(vm.form.branch().errors().map((e) => e.message)).toEqual(['Nomme la branche']);
    expect(vm.form.name().invalid()).toBe(false);
    vm.setGit('worktree'); // branche facultative hors mode « nouvelle branche »
    expect(vm.form.branch().invalid()).toBe(false);
    vm.setCwd('~/x');
    expect(vm.form().valid()).toBe(true);
  });

  it('lance avec Cmd+Entrée sur mac, Ctrl+Entrée ailleurs', () => {
    const mac = createVm().vm;
    expect(mac.launchKey).toBe('⌘↵');
    const launchMac = vi.spyOn(mac, 'launch').mockResolvedValue();
    mac.launchOnShortcut(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(launchMac).not.toHaveBeenCalled();
    mac.launchOnShortcut(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    expect(launchMac).toHaveBeenCalledOnce();

    TestBed.resetTestingModule();
    const linux = createVm(undefined, 'linux').vm;
    expect(linux.launchKey).toBe('Ctrl+↵');
    const launch = vi.spyOn(linux, 'launch').mockResolvedValue();
    linux.launchOnShortcut(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    linux.launchOnShortcut(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(launch).not.toHaveBeenCalled();
    const e = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true });
    linux.launchOnShortcut(e);
    expect(launch).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('sélecteur de dossier natif', () => {
  afterEach(() => { delete (globalThis as { vigieDesktop?: unknown }).vigieDesktop; TestBed.resetTestingModule(); });

  it("part du dossier tapé et remplit le champ avec le choix ; absent hors de l'app de bureau", async () => {
    expect(createVm().vm.canPick).toBe(false);
    TestBed.resetTestingModule();
    const pickFolder = vi.fn(async (): Promise<string | null> => '/Users/moi/dev/app');
    (globalThis as { vigieDesktop?: unknown }).vigieDesktop = { pickFolder };
    const { vm } = createVm();
    expect(vm.canPick).toBe(true);
    vm.setQuery('~/dev/ap');
    await vm.pickFolder();
    expect(pickFolder).toHaveBeenCalledWith('~/dev/');
    expect(vm.query()).toBe('/Users/moi/dev/app');
    expect(vm.model().cwd).toBe('/Users/moi/dev/app');
    pickFolder.mockResolvedValueOnce(null);
    await vm.pickFolder();
    expect(vm.model().cwd).toBe('/Users/moi/dev/app');
  });
});
