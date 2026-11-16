import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { provideConfirmServiceMock } from '../../../../core/confirm.service.mock';
import { CLIENT_OS } from '../../../../core/platform';
import { aProjectFiles, provideVigieServiceMock } from '../../../../core/vigie.service.mock';
import { FilesSearchVm } from '../search/files-search.vm';
import { SessionFilesVm } from '../session-files.vm';
import { FilesFinderVm } from './files-finder.vm';

async function setup() {
  localStorage.removeItem('vigie.files.side');
  TestBed.configureTestingModule({
    providers: [SessionFilesVm, FilesSearchVm, FilesFinderVm, provideConfirmServiceMock(), { provide: CLIENT_OS, useValue: 'linux' },
      provideVigieServiceMock({ files: vi.fn(async () => aProjectFiles({ files: ['src/app/main.ts', 'src/a.ts', 'README.md'] })) })],
  });
  const files = TestBed.inject(SessionFilesVm);
  files.connect(signal('s1'), signal(true));
  await TestBed.inject(ApplicationRef).whenStable();
  return { vm: TestBed.inject(FilesFinderVm), files, search: TestBed.inject(FilesSearchVm) };
}

describe('FilesFinderVm', () => {
  it('saisie vide : onglets ouverts d’abord, puis le projet, sans ligne « dans le contenu »', async () => {
    const { vm, files } = await setup();
    await files.open('README.md');
    vm.reset();
    expect(vm.hits()).toEqual(['README.md', 'src/app/main.ts', 'src/a.ts']);
    expect(vm.count()).toBe(3);
    expect(vm.pick(3)).toBeNull();
  });

  it('filtre en recherche floue, flèches circulaires ; Entrée ouvre le fichier, gardé (pas en aperçu)', async () => {
    const { vm, files } = await setup();
    vm.query.set('main');
    expect(vm.hits()).toEqual(['src/app/main.ts']);
    expect([vm.count(), vm.index()]).toEqual([2, 0]);
    expect(vm.key('ArrowDown')).toEqual({ handled: true, move: null });
    expect(vm.index()).toBe(1); // la ligne « dans le contenu »
    vm.key('ArrowDown');
    expect(vm.index()).toBe(0); // circulaire
    vm.key('ArrowUp');
    expect(vm.index()).toBe(1);
    vm.key('ArrowUp');
    expect(vm.key('Enter')).toEqual({ handled: true, move: 'opened' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(files.active()).toMatchObject({ path: 'src/app/main.ts', preview: false });
    expect(vm.key('Escape').handled).toBe(false); // laissé au <dialog>
  });

  it('la ligne « Chercher « … » dans le contenu » ouvre Rechercher pré-rempli, même panneau masqué', async () => {
    const { vm, files, search } = await setup();
    files.showPanel(false);
    vm.query.set('  export const ');
    expect(vm.hits()).toEqual([]);
    expect(vm.count()).toBe(1);
    expect(vm.key('Enter')).toEqual({ handled: true, move: 'search' });
    expect(search.query()).toBe('export const');
    expect([files.side(), files.panelShown()]).toEqual(['search', true]);
    localStorage.removeItem('vigie.files.side');
    localStorage.removeItem('vigie.files.collapsed');
  });

  it('reset : la fenêtre se rouvre sur une saisie vide', async () => {
    const { vm } = await setup();
    vm.query.set('zzz');
    vm.reset();
    expect([vm.query(), vm.index()]).toEqual(['', 0]);
  });
});
