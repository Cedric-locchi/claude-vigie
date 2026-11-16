import { ApplicationRef, Signal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../core/confirm.service';
import { provideConfirmServiceMock } from '../../core/confirm.service.mock';
import { GitDiff, SessionTrace } from '../../core/models';
import { CLIENT_OS } from '../../core/platform';
import { OUTDATED, VigieService } from '../../core/vigie.service';
import { aProjectFiles, fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { SessionPageVm } from './session-page.vm';
import { MAX_MATCHES, Row, SessionFilesVm, Tab, buildTree, closeTab, openTab, treeKey } from './session-files.vm';

const httpError = (status: number, error: string) => Object.assign(new Error('http'), { status, error: { error } });

async function setup(extra: Partial<VigieService> = {}, answer = true) {
  TestBed.configureTestingModule({ providers: [SessionFilesVm, provideConfirmServiceMock(answer), provideVigieServiceMock(extra), { provide: CLIENT_OS, useValue: 'linux' }] });
  const vm = TestBed.inject(SessionFilesVm);
  const idle = signal(true);
  vm.connect(signal('s1'), idle);
  await TestBed.inject(ApplicationRef).whenStable();
  return { vm, idle, vigie: TestBed.inject(VigieService), confirm: TestBed.inject(ConfirmService) };
}

const names = (vm: SessionFilesVm) => vm.view().rows.map((r) => '  '.repeat(r.depth) + r.name + (r.kind === 'file' ? '' : r.open ? '/-' : '/+'));
const key = (k: string, mods: Partial<KeyboardEvent> = { ctrlKey: true }) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
const tab = (path: string, draft: string | null = null): Tab => ({ path, body: { path, content: 'x', hash: 'h' }, error: null, draft, conflict: false });

describe('buildTree', () => {
  it('dossiers avant fichiers, triés par nom (chiffres dans l’ordre naturel)', () => {
    const t = buildTree(['b.ts', 'src/z.ts', 'a.ts', 'src/app/x.ts', 'lib/f10.ts', 'lib/f2.ts', 'Docs/r.md'], ['node_modules']);
    expect(t.get('')).toEqual({ dirs: ['Docs', 'lib', 'node_modules', 'src'], files: ['a.ts', 'b.ts'] });
    expect(t.get('lib')!.files).toEqual(['lib/f2.ts', 'lib/f10.ts']);
    expect(t.get('src')).toEqual({ dirs: ['src/app'], files: ['src/z.ts'] });
    expect(t.get('node_modules')).toEqual({ dirs: [], files: [] });
  });
});

describe('openTab / closeTab', () => {
  it('ouvre sans doublon ; au-delà du plafond, ferme le plus ancien sans saisie', () => {
    let ts = openTab([], 'a', 3);
    ts = openTab(ts, 'a', 3);
    expect(ts.map((t) => t.path)).toEqual(['a']);
    ts = [tab('a', 'modifié'), tab('b'), tab('c')];
    expect(openTab(ts, 'd', 3).map((t) => t.path)).toEqual(['a', 'c', 'd']);
    // Tous modifiés : on dépasse plutôt que de perdre une saisie.
    expect(openTab([tab('a', 'm'), tab('b', 'm')], 'c', 2).map((t) => t.path)).toEqual(['a', 'b', 'c']);
    // En édition sans changement : fermable.
    expect(openTab([tab('a', 'x'), tab('b', 'm')], 'c', 2).map((t) => t.path)).toEqual(['b', 'c']);
  });

  it('fermer l’onglet actif active son voisin de droite, sinon de gauche', () => {
    const ts = [tab('a'), tab('b'), tab('c')];
    expect(closeTab(ts, 'b', 'b')).toEqual({ tabs: [ts[0], ts[2]], active: 'c' });
    expect(closeTab(ts, 'c', 'c').active).toBe('b');
    expect(closeTab(ts, 'a', 'c').active).toBe('c');
    expect(closeTab([ts[0]], 'a', 'a')).toEqual({ tabs: [], active: null });
  });
});

describe('treeKey', () => {
  const rows: Row[] = [
    { path: 'src', name: 'src', depth: 0, kind: 'dir', open: true },
    { path: 'src/a.ts', name: 'a.ts', depth: 1, kind: 'file', open: false },
    { path: 'lib', name: 'lib', depth: 0, kind: 'dir', open: false },
    { path: 'dist', name: 'dist', depth: 0, kind: 'ignored', open: false },
  ];
  it('flèches, début, fin', () => {
    expect(treeKey(rows, 0, 'ArrowDown')).toEqual({ focus: 1 });
    expect(treeKey(rows, 3, 'ArrowDown')).toEqual({ focus: 3 });
    expect(treeKey(rows, 0, 'ArrowUp')).toEqual({ focus: 0 });
    expect(treeKey(rows, 2, 'Home')).toEqual({ focus: 0 });
    expect(treeKey(rows, 0, 'End')).toEqual({ focus: 3 });
    expect(treeKey(rows, 0, 'x')).toBeNull();
  });
  it('droite déplie puis descend, gauche replie puis remonte au parent ; Entrée ouvre ou plie', () => {
    expect(treeKey(rows, 2, 'ArrowRight')).toEqual({ focus: 2, toggle: 'lib' });
    expect(treeKey(rows, 0, 'ArrowRight')).toEqual({ focus: 1 });
    expect(treeKey(rows, 0, 'ArrowLeft')).toEqual({ focus: 0, toggle: 'src' });
    expect(treeKey(rows, 1, 'ArrowLeft')).toEqual({ focus: 0 });
    expect(treeKey(rows, 1, 'Enter')).toEqual({ focus: 1, open: 'src/a.ts' });
    expect(treeKey(rows, 2, ' ')).toEqual({ focus: 2, toggle: 'lib' });
    expect(treeKey(rows, 3, 'Enter')).toEqual({ focus: 3 });
  });
});

describe('SessionFilesVm', () => {
  it('charge la liste à la connexion ; seuls les dossiers dépliés sont rendus', async () => {
    const { vm, vigie } = await setup({ files: vi.fn(async () => aProjectFiles({ files: ['src/app/a.ts', 'src/b.ts', 'README.md'], collapsed: ['dist'] })) });
    expect(vigie.files).toHaveBeenCalledWith('s1');
    expect(names(vm)).toEqual(['dist/+', 'src/+', 'README.md']);
    expect(vm.view().rows[0].kind).toBe('ignored');
    vm.toggle('src');
    expect(names(vm)).toEqual(['dist/+', 'src/-', '  app/+', '  b.ts', 'README.md']);
    vm.toggle('src');
    expect(names(vm)).toEqual(['dist/+', 'src/+', 'README.md']);
    vm.refresh();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(vigie.files).toHaveBeenCalledTimes(2);
  });

  it('le filtre garde les résultats et déplie leurs dossiers', async () => {
    const { vm } = await setup({ files: vi.fn(async () => aProjectFiles({ files: ['src/app/Main.ts', 'src/b.ts', 'lib/main.md', 'README.md'], collapsed: ['node_modules'] })) });
    vm.query.set(' main ');
    expect(names(vm)).toEqual(['lib/-', '  main.md', 'src/-', '  app/-', '    Main.ts']);
    vm.query.set('zzz');
    expect(vm.view().rows).toEqual([]);
    vm.query.set('');
    expect(names(vm)).toEqual(['lib/+', 'node_modules/+', 'src/+', 'README.md']);
  });

  it('le filtre s’arrête au-delà de MAX_MATCHES résultats', async () => {
    const files = Array.from({ length: MAX_MATCHES + 10 }, (_, i) => `d/f${i}.ts`);
    const { vm } = await setup({ files: vi.fn(async () => aProjectFiles({ files, collapsed: [] })) });
    vm.query.set('f');
    expect(vm.view().limited).toBe(true);
    expect(vm.view().rows).toHaveLength(MAX_MATCHES + 1); // + le dossier
  });

  it('réponse hors contrat : message « le daemon est-il à jour ? »', async () => {
    const { vm } = await setup({ files: vi.fn(async () => { throw new Error(OUTDATED); }) });
    expect(vm.listError()).toBe(OUTDATED);
    expect(vm.project()).toBeNull();
  });

  it('clavier dans l’arbre : déplie, descend, ouvre ; le fil d’Ariane révèle un dossier', async () => {
    const { vm } = await setup();
    expect(vm.focusRow()).toBe('node_modules');
    vm.treeKey('ArrowDown');
    expect(vm.focusRow()).toBe('src');
    vm.treeKey('ArrowRight');
    expect(names(vm)).toContain('  a.ts');
    vm.treeKey('ArrowRight');
    vm.treeKey('Enter');
    await TestBed.inject(ApplicationRef).whenStable();
    expect(vm.active()?.path).toBe('src/a.ts');
    vm.toggle('src');
    vm.query.set('readme');
    vm.reveal('src');
    expect(vm.query()).toBe('');
    expect(names(vm)).toContain('src/-');
    expect(vm.focusRow()).toBe('src');
  });

  it('ouvre des onglets ; un refus du daemon (binaire, trop gros) s’affiche dans le sien', async () => {
    const readProjectFile = vi.fn()
      .mockResolvedValueOnce({ path: 'src/a.ts', content: 'x\ny', hash: 'h1' })
      .mockRejectedValueOnce(httpError(400, 'Fichier binaire'));
    const { vm } = await setup({ readProjectFile });
    await vm.open('src/a.ts');
    expect(readProjectFile).toHaveBeenCalledWith('s1', 'src/a.ts');
    expect(vm.active()).toMatchObject({ path: 'src/a.ts', body: { content: 'x\ny', hash: 'h1' }, error: null, draft: null });
    expect(vm.status()).toEqual({ lang: 'TypeScript', lines: 2, eol: 'LF' });
    expect(vm.crumbs()).toEqual([{ name: 'src', path: 'src' }, { name: 'a.ts', path: 'src/a.ts' }]);
    vm.caret.set(3);
    expect(vm.position()).toEqual({ line: 2, col: 2 });
    await vm.open('logo.png');
    expect(vm.tabs().map((t) => t.path)).toEqual(['src/a.ts', 'logo.png']);
    expect(vm.active()).toMatchObject({ path: 'logo.png', body: null, error: 'Fichier binaire' });
    expect(vm.position()).toEqual({ line: 1, col: 1 }); // curseur remis au début
  });

  it('marqueurs de gouttière et statuts de l’arbre d’après le diff git', async () => {
    const diff: GitDiff = {
      cwd: '/dev/meeplebox', repo: true, root: '/dev/meeplebox', branch: 'main', total: 1,
      files: [{ path: 'src/a.ts', status: 'M', staged: false, unstaged: true, added: 1, removed: 0, patch: '@@ -1 +1,2 @@\n a\n+b', truncated: false }],
    };
    const { vm } = await setup({ gitResource: (() => fakeResource(diff)) as unknown as VigieService['gitResource'] });
    expect(vm.changes().dirs.has('src')).toBe(true);
    expect(vm.changes().files.get('src/a.ts')?.status).toBe('M');
    await vm.open('src/a.ts');
    expect(vm.marks()).toMatchObject([{ kind: 'add', from: 2, to: 2 }]);
    await vm.open('README.md');
    expect(vm.marks()).toEqual([]);
  });

  it('un markdown s’ouvre en aperçu ; « Aperçu » désactivé montre la source, jusqu’à l’onglet suivant', async () => {
    const readProjectFile = vi.fn(async (_id: string, path: string) => ({ path, content: path === 'README.md' ? '# Titre' : '- un', hash: 'h' }));
    const { vm } = await setup({ readProjectFile });
    await vm.open('README.md');
    expect(vm.markdown()).toContain('<h1>Titre</h1>');
    vm.showSource.set(true);
    expect(vm.markdown()).toBeNull();
    await vm.open('NOTES.md');
    expect(vm.showSource()).toBe(false);
    expect(vm.markdown()).toContain('<li>un</li>');
    await vm.startEdit();
    expect(vm.markdown()).toBeNull(); // en édition : la source
  });

  it('un brouillon par onglet, conservé en passant d’un onglet à l’autre', async () => {
    const { vm, vigie } = await setup();
    await vm.open('a.ts');
    await vm.startEdit();
    vm.edit('saisie A');
    await vm.open('b.ts');
    expect(vm.editing()).toBe(false);
    expect(vm.text()).toBe('export const a = 1;\n');
    await vm.activate('a.ts');
    expect(vm.text()).toBe('saisie A');
    expect(vm.dirty()).toBe(true);
    expect(vigie.readProjectFile).toHaveBeenCalledTimes(3); // a, édition de a, b ; a en édition n'est pas relu
  });

  it('fermer un onglet modifié demande confirmation ; un onglet propre se ferme sans question', async () => {
    const { vm, confirm } = await setup({}, false);
    await vm.open('a.ts');
    await vm.open('b.ts');
    await vm.close('b.ts');
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(vm.active()?.path).toBe('a.ts');
    await vm.startEdit();
    vm.edit('saisie');
    await vm.close('a.ts'); // refusé
    expect(confirm.ask).toHaveBeenCalledOnce();
    expect(vm.text()).toBe('saisie');
    vi.mocked(confirm.ask).mockResolvedValueOnce(true);
    await vm.close('a.ts');
    expect(vm.tabs()).toEqual([]);
    expect(vm.active()).toBeNull();
  });

  it('Ctrl+S enregistre avec l’empreinte lue et les fins de ligne du fichier, puis relit ; Ctrl+P vise le filtre ; Ctrl+W laissé au système', async () => {
    const readProjectFile = vi.fn(async (_id: string, path: string) => ({ path, content: 'a\r\nb\r\n', hash: 'h1' }));
    const { vm, vigie } = await setup({ readProjectFile });
    await vm.open('a.ts');
    await vm.startEdit();
    expect(vm.dirty()).toBe(false);
    vm.edit('a\nb\nc\n');
    expect(vm.status()?.eol).toBe('CRLF');
    const s = key('s');
    expect(vm.shortcut(s)).toBeNull();
    expect(s.preventDefault).toHaveBeenCalled();
    await TestBed.inject(ApplicationRef).whenStable();
    await vi.waitFor(() => expect(vm.editing()).toBe(false));
    expect(vigie.writeProjectFile).toHaveBeenCalledWith('s1', { path: 'a.ts', content: 'a\r\nb\r\nc\r\n', hash: 'h1' });
    expect(vm.shortcut(key('s', { metaKey: true }))).toBeNull(); // ⌘ hors mac : ignoré
    expect(vm.shortcut(key('p'))).toBe('filter');
    const w = key('w');
    vm.shortcut(w);
    expect(w.preventDefault).not.toHaveBeenCalled();
    expect(vm.tabs().length).toBe(1);
  });

  it('bloqué pendant que Claude travaille', async () => {
    const { vm, idle, vigie } = await setup();
    await vm.open('a.ts');
    idle.set(false);
    await vm.startEdit();
    expect(vm.editing()).toBe(false);
    idle.set(true);
    await vm.startEdit();
    vm.edit('saisie');
    idle.set(false);
    await vm.save();
    expect(vigie.writeProjectFile).not.toHaveBeenCalled();
    expect(vm.text()).toBe('saisie');
  });

  it('412 : propose de recharger en gardant la saisie ; autre refus : message du daemon', async () => {
    const writeProjectFile = vi.fn().mockRejectedValueOnce(httpError(412, 'Fichier modifié entre-temps')).mockRejectedValueOnce(httpError(403, 'Config Claude en lecture seule'));
    const { vm } = await setup({ writeProjectFile });
    await vm.open('a.ts');
    await vm.startEdit();
    vm.edit('saisie');
    await vm.save();
    expect(vm.active()?.conflict).toBe(true);
    expect(vm.error()).toBeNull();
    expect(vm.text()).toBe('saisie');
    await vm.load();
    expect(vm.active()?.conflict).toBe(false);
    expect(vm.text()).toBe('export const a = 1;\n');
    vm.edit('autre');
    await vm.save();
    expect(vm.error()).toBe('Config Claude en lecture seule');
    expect(vm.editing()).toBe(true);
  });

  describe('ce que Claude a touché', () => {
    const trace = (steps: [string, string, number][]): SessionTrace => ({
      now: 0, state: 'turn', waiting: null,
      turns: [{ index: 7, start: 0, end: 0, prompt: '', live: false, steps: steps.map(([kind, label, start]) => ({ id: label + start, name: 'Edit', kind: kind as 'read', label, start, end: start, error: false, agent: null })) }],
    });
    const files = ['src/a.ts', 'src/b.ts', 'README.md', '.DS_Store', 'src/.DS_Store'];
    const traced = (t: SessionTrace, extra: Partial<VigieService> = {}) => {
      const versions: Signal<number>[] = [];
      const traceResource = ((_: unknown, v: Signal<number>) => { versions.push(v); return fakeResource(t); }) as unknown as VigieService['traceResource'];
      return { versions, extra: { files: vi.fn(async () => aProjectFiles({ root: '/dev/meeplebox', files })), traceResource, ...extra } };
    };

    it('liste, marques de l’arbre, fichiers système masqués ; ouvre d’office le dernier modifié', async () => {
      const { extra } = traced(trace([['read', 'meeplebox/README.md', 1], ['edit', '/dev/meeplebox/src/a.ts', 2], ['read', 'src/b.ts', 3], ['edit', '/etc/hosts', 4]]));
      const { vm, vigie } = await setup(extra);
      expect(vm.touched().map((t) => [t.path, t.edited])).toEqual([['src/b.ts', false], ['src/a.ts', true], ['README.md', false]]);
      expect(vm.files()).toEqual(['src/a.ts', 'src/b.ts', 'README.md']);
      expect(names(vm)).toEqual(['node_modules/+', 'src/+', 'README.md']);
      expect(vm.editedDirs().get('src')).toBe(1);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(vigie.readProjectFile).toHaveBeenCalledWith('s1', 'src/a.ts');
      expect(vm.active()?.path).toBe('src/a.ts');
      expect(vm.activeTouch()).toMatchObject({ editTurn: 7, label: '/dev/meeplebox/src/a.ts' });
      expect(vm.canShowHistory).toBe(false);
    });

    it('sans fichier modifié, rien ne s’ouvre ; un onglet déjà ouvert n’est pas remplacé', async () => {
      const { extra } = traced(trace([['read', 'src/b.ts', 1]]));
      const { vm, vigie } = await setup(extra);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(vm.tabs()).toEqual([]);
      expect(vigie.readProjectFile).not.toHaveBeenCalled();
    });

    it('relit l’arbre et la trace quand Claude change d’état, pas autrement', async () => {
      const { extra, versions } = traced(trace([]));
      const { vm, vigie, idle } = await setup(extra);
      const v = versions[0]();
      idle.set(false);
      await TestBed.inject(ApplicationRef).whenStable();
      expect(versions[0]()).toBe(v + 1);
      expect(vigie.files).toHaveBeenCalledTimes(2);
      expect(vm.project()?.files).toEqual(files); // garde l'arbre pendant la relecture
    });

    it('« Voir dans l’historique » ouvre le journal de la page sur le fichier', async () => {
      const openLog = vi.fn();
      const { extra } = traced(trace([['edit', 'src/a.ts', 1]]));
      TestBed.configureTestingModule({ providers: [{ provide: SessionPageVm, useValue: { openLog } }] });
      const { vm } = await setup(extra);
      expect(vm.canShowHistory).toBe(true);
      vm.showInHistory(vm.touched()[0]);
      expect(openLog).toHaveBeenCalledWith('src/a.ts');
    });

    it('retour à la ligne mémorisé', async () => {
      localStorage.removeItem('vigie.files.wrap');
      const { vm } = await setup();
      expect(vm.wrap()).toBe(false);
      vm.toggleWrap();
      expect(vm.wrap()).toBe(true);
      expect(localStorage.getItem('vigie.files.wrap')).toBe('1');
      localStorage.removeItem('vigie.files.wrap');
    });
  });
});
