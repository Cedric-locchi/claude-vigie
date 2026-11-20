import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provideConfirmServiceMock } from '../../../../core/confirm.service.mock';
import { SearchResults } from '../../../../core/models';
import { CLIENT_OS } from '../../../../core/platform';
import { SEARCH_DELAY, VigieService } from '../../../../core/vigie.service';
import { aSearchResults, provideVigieServiceMock } from '../../../../core/vigie.service.mock';
import { FilesSearchVm } from './files-search.vm';
import { SessionFilesVm } from '../session-files.vm';

const CONTENT = 'export const a = 1;\n\n  export const b = 2;\n';

function setup(extra: Partial<VigieService> = {}) {
  TestBed.configureTestingModule({
    providers: [SessionFilesVm, FilesSearchVm, provideConfirmServiceMock(), { provide: CLIENT_OS, useValue: 'linux' },
      provideVigieServiceMock({ readProjectFile: vi.fn(async (_id: string, path: string) => ({ path, content: CONTENT, hash: 'h' })), ...extra })],
  });
  const files = TestBed.inject(SessionFilesVm);
  files.connect(signal('s1'), signal(true));
  return { vm: TestBed.inject(FilesSearchVm), files, vigie: TestBed.inject(VigieService) };
}

/** Saisie puis attente (fausse horloge) ; les effets (debounced, resource) passent à chaque tick. */
async function type(vm: FilesSearchVm, q: string, wait = SEARCH_DELAY) {
  vm.query.set(q);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(wait);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(0);
  TestBed.tick();
}

describe('FilesSearchVm', () => {
  afterEach(() => vi.useRealTimers());

  it('attend 250 ms après la dernière frappe et 2 caractères avant d’interroger le daemon', async () => {
    vi.useFakeTimers();
    const { vm, vigie } = setup();
    await type(vm, 'e', 1000);
    expect(vm.summary()).toEqual({ text: 'Tape au moins 2 caractères.' });
    expect(vigie.searchFiles).not.toHaveBeenCalled();

    await type(vm, 'ex', 100);
    await type(vm, 'exp', SEARCH_DELAY - 10);
    expect(vigie.searchFiles).not.toHaveBeenCalled();
    expect(vm.summary()).toEqual({ text: 'Recherche…' });
    await type(vm, 'exp', 10);
    expect(vigie.searchFiles).toHaveBeenCalledTimes(1);
    expect(vigie.searchFiles).toHaveBeenCalledWith('s1', 'exp', false, expect.any(AbortSignal));
    expect(vm.summary()).toEqual({ text: '3 résultats dans 2 fichiers' });

    vm.toggleCase();
    await type(vm, 'exp');
    expect(vigie.searchFiles).toHaveBeenLastCalledWith('s1', 'exp', true, expect.any(AbortSignal));

    await type(vm, 'e', 0); // repasse sous le minimum : résultats retirés tout de suite, sans requête
    expect(vm.rows()).toEqual([]);
    expect(vigie.searchFiles).toHaveBeenCalledTimes(2);
  });

  it('une nouvelle requête coupe la précédente ; sa réponse tardive n’est jamais affichée', async () => {
    vi.useFakeTimers();
    const calls: { q: string; signal: AbortSignal; resolve: (r: SearchResults) => void }[] = [];
    const { vm } = setup({
      searchFiles: vi.fn((_id: string, q: string, _c: boolean, signal?: AbortSignal) => new Promise<SearchResults>((resolve) => calls.push({ q, signal: signal!, resolve }))),
    });
    await type(vm, 'ab');
    await type(vm, 'abc');
    expect(calls.map((c) => c.q)).toEqual(['ab', 'abc']);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);

    calls[1].resolve(aSearchResults({ files: [{ path: 'new.ts', matches: [{ line: 1, col: 1, text: 'abc', at: 0 }] }] }));
    await type(vm, 'abc', 0);
    calls[0].resolve(aSearchResults()); // réponse périmée, arrivée après
    await type(vm, 'abc', 0);
    expect(vm.rows().map((r) => r.path)).toEqual(['new.ts', 'new.ts#1']);
    expect(vm.rows()[1].parts).toEqual({ pre: '', hit: 'abc', post: '' });
  });

  it('groupe par fichier, compte, surligne avec la requête de la réponse ; un fichier se replie', async () => {
    vi.useFakeTimers();
    const { vm } = setup({ searchFiles: vi.fn(async () => aSearchResults({ truncated: true })) });
    await type(vm, 'export');
    const rows = vm.rows();
    expect(rows.map((r) => [r.path, r.depth, r.count])).toEqual([
      ['src/a.ts', 0, 2], ['src/a.ts#1', 1, 0], ['src/a.ts#3', 1, 0], ['README.md', 0, 1], ['README.md#2', 1, 0],
    ]);
    expect(rows[0]).toMatchObject({ name: 'a.ts', dir: 'src', open: true });
    expect(rows[3].dir).toBe('');
    expect(rows[2].parts).toEqual({ pre: '', hit: 'export', post: ' const b = 2;' }); // indentation retirée
    expect(rows[4].parts).toEqual({ pre: 'On ', hit: 'export', post: ' tout.' });
    expect(vm.truncated()).toBe(true);

    vm.query.set('exporx'); // saisie en cours : les résultats affichés gardent leur surlignage
    TestBed.tick();
    expect(vm.rows()[1].parts!.hit).toBe('export');

    vm.pick(rows[0]);
    expect(vm.rows().map((r) => r.path)).toEqual(['src/a.ts', 'README.md', 'README.md#2']);
    expect(vm.key('ArrowDown')).toBe(true); // clavier de l'arbre : descend sur README.md
    expect(vm.focusRow()).toBe('README.md');
    expect(vm.key('ArrowLeft')).toBe(true); // replie
    expect(vm.rows().map((r) => r.path)).toEqual(['src/a.ts', 'README.md']);
  });

  it('aucun résultat, puis message du daemon en cas de refus', async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => aSearchResults({ files: [] }));
    const { vm } = setup({ searchFiles: search });
    await type(vm, 'zz');
    expect(vm.summary()).toEqual({ text: 'Aucun résultat' });
    search.mockRejectedValueOnce(Object.assign(new Error('http'), { status: 400, error: { error: '200 caractères au plus' } }));
    await type(vm, 'zzz');
    expect(vm.summary()).toEqual({ text: '200 caractères au plus', err: true });
    expect(vm.rows()).toEqual([]);
  });

  it('clic sur un résultat : ouvre le fichier en aperçu, curseur et défilement à la ligne', async () => {
    vi.useFakeTimers();
    const { vm, files } = setup();
    await type(vm, 'export');
    const hit = vm.rows().find((r) => r.path === 'src/a.ts#3')!;
    const done = vm.pick(hit);
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(files.active()?.path).toBe('src/a.ts');
    expect(files.active()?.preview).toBe(true);
    expect(files.position()).toEqual({ line: 3, col: 3 });
    expect(files.goto()).toEqual({ line: 3, offset: CONTENT.indexOf('export const b') });
  });

  it('Ctrl+Shift+F ouvre le tiroir sur Rechercher, sans le refermer ; Ctrl+F aussi tant qu’aucun fichier n’est ouvert', () => {
    const { files } = setup();
    const key = (mods: KeyboardEventInit) => new KeyboardEvent('keydown', { key: mods.shiftKey ? 'F' : 'f', ...mods });
    files.narrow.set(true);
    expect(files.shortcut(key({ ctrlKey: true, shiftKey: true }))).toBe('search');
    expect([files.panelShown(), files.side()]).toEqual([true, 'search']);
    expect(files.shortcut(key({ ctrlKey: true, shiftKey: true }))).toBe('search');
    expect(files.panelShown()).toBe(true);
    expect(files.shortcut(key({ ctrlKey: true }))).toBe('search');
    expect(files.shortcut(key({ ctrlKey: true, altKey: true }))).toBeNull();
  });
});
