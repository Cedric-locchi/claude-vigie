import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmService } from '../../../core/confirm.service';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { GitDiff, GitFile } from '../../../core/models';
import { VigieService } from '../../../core/vigie.service';
import { aGitDiff, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { DISCARD_EDIT, SessionDiffVm, parsePatch } from './session-diff.vm';

describe('parsePatch', () => {
  it('numérote les lignes et saute les en-têtes', () => {
    const lines = parsePatch('diff --git a/a b/a\nindex 1..2\n--- a/a\n+++ b/a\n@@ -3,2 +3,3 @@ fn\n un\n-deux\n+2\n+trois\n\\ No newline at end of file\n');
    expect(lines.map((l) => [l.kind, l.old, l.new, l.text])).toEqual([
      ['hunk', null, null, '@@ -3,2 +3,3 @@ fn'],
      ['ctx', 3, 3, 'un'],
      ['del', 4, null, 'deux'],
      ['add', null, 4, '2'],
      ['add', null, 5, 'trois'],
    ]);
  });
});

describe('SessionDiffVm', () => {
  it('garde le diff affiché pendant un rechargement (pas de clignotement)', () => {
    const resource = fakeResource<GitDiff | undefined>(aGitDiff());
    TestBed.configureTestingModule({
      providers: [SessionDiffVm, provideVigieServiceMock({ gitResource: () => resource }), provideConfirmServiceMock()],
    });
    const vm = TestBed.inject(SessionDiffVm);
    vm.connect(signal('s1'), signal(1), signal(true));
    const first = vm.diff();
    expect(first).not.toBeNull();
    resource.set(undefined); // nouvelle URL ?v= : httpResource repasse à undefined
    expect(vm.diff()).toBe(first);
  });

  it('lecture du dépôt en échec : la raison, daemon injoignable compris', () => {
    TestBed.configureTestingModule({
      providers: [SessionDiffVm, provideConfirmServiceMock(), provideVigieServiceMock({ gitResource: () => fakeResource(undefined, 'error', new HttpErrorResponse({ status: 0 })) })],
    });
    const vm = TestBed.inject(SessionDiffVm);
    vm.connect(signal('s1'), signal(1), signal(true));
    expect([vm.diff(), vm.loadError()]).toEqual([null, 'Le daemon ne répond pas']);
  });

  it('ne commite pas un message vide (même règle que le daemon), commite un message rempli', async () => {
    const resource = fakeResource(aGitDiff());
    const commit = vi.fn(async () => ({ ok: true }));
    const suggestCommitMessage = vi.fn(async () => ({ message: 'feat: suggestions' }));
    TestBed.configureTestingModule({
      providers: [SessionDiffVm, provideConfirmServiceMock(), provideVigieServiceMock({
        gitResource: () => resource, commit, suggestCommitMessage,
      })],
    });
    const vm = TestBed.inject(SessionDiffVm);
    vm.connect(signal('s1'), signal(1), signal(true));

    await vm.generateCommitMessage();
    expect(vm.commitOpen()).toBe(true);
    expect(vm.commitForm.message().invalid()).toBe(false);

    vm.commitModel.set({ message: '   ' });
    expect(vm.commitForm.message().invalid()).toBe(true);
    await vm.commit();
    expect(commit).not.toHaveBeenCalled();
    expect(vm.commitForm.message().touched()).toBe(true); // l'erreur s'affiche

    vm.commitModel.set({ message: '  fix: x  ' });
    await vm.commit();
    expect(commit).toHaveBeenCalledWith('s1', 'fix: x');
    expect(vm.commitOpen()).toBe(false);
  });

  it('copie le message proposé, tel qu’il est dans le champ', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(document.defaultView!.navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      TestBed.configureTestingModule({ providers: [SessionDiffVm, provideConfirmServiceMock(), provideVigieServiceMock({ gitResource: () => fakeResource(aGitDiff()) })] });
      const vm = TestBed.inject(SessionDiffVm);
      vm.commitModel.set({ message: 'feat: x' });
      await vm.copyMessage();
      expect(writeText).toHaveBeenCalledWith('feat: x');
      expect(vm.copied()).toBe(true);
    } finally {
      Reflect.deleteProperty(document.defaultView!.navigator, 'clipboard');
    }
  });

  it('nouvelle branche : nom vérifié comme le daemon, puis git switch -c', async () => {
    const resource = fakeResource(aGitDiff());
    const createBranch = vi.fn(async () => ({ ok: true }));
    TestBed.configureTestingModule({
      providers: [SessionDiffVm, provideConfirmServiceMock(), provideVigieServiceMock({
        gitResource: () => resource, createBranch,
      })],
    });
    const vm = TestBed.inject(SessionDiffVm);
    vm.connect(signal('s1'), signal(1), signal(true));
    vm.branchOpen.set(true);
    vm.branchName.set('--force');
    expect(vm.branchNameError()).toBeTruthy();
    await vm.createBranch();
    expect(createBranch).not.toHaveBeenCalled();
    vm.branchName.set(' feat/x ');
    expect(vm.branchNameError()).toBeNull();
    await vm.createBranch();
    expect(createBranch).toHaveBeenCalledWith('s1', 'feat/x');
    expect(vm.branchOpen()).toBe(false);
    expect(resource.reload).toHaveBeenCalled();
  });

  describe('édition d’un fichier', () => {
    const file = (o: Partial<GitFile> = {}): GitFile => ({ path: 'a.ts', status: 'M', added: 1, removed: 0, staged: false, unstaged: true, truncated: false, patch: '@@ -1 +1 @@\n-x\n+y\n', ...o });
    function setup(files: GitFile[], extra: Partial<VigieService> = {}, answer = true) {
      const resource = fakeResource(aGitDiff({ files }));
      TestBed.configureTestingModule({
        providers: [SessionDiffVm, provideConfirmServiceMock(answer), provideVigieServiceMock({ gitResource: () => resource, ...extra })],
      });
      const vm = TestBed.inject(SessionDiffVm);
      const idle = signal(true);
      vm.connect(signal('s1'), signal(1), idle);
      return { vm, idle, resource, vigie: TestBed.inject(VigieService) };
    }
    const httpError = (status: number, error: string) => Object.assign(new Error('http'), { status, error: { error } });

    it('pas d’édition pour un fichier supprimé ou binaire', () => {
      expect(setup([file({ status: 'D' })]).vm.editable()).toBe(false);
      TestBed.resetTestingModule();
      expect(setup([file({ patch: 'Binary files differ' })]).vm.editable()).toBe(false);
      TestBed.resetTestingModule();
      expect(setup([file()]).vm.editable()).toBe(true);
    });

    it('bloquée pendant que Claude travaille ; la saisie survit au retour en cours', async () => {
      const { vm, idle, vigie } = setup([file()]);
      idle.set(false);
      await vm.startEdit();
      expect(vigie.gitFile).not.toHaveBeenCalled();
      idle.set(true);
      await vm.startEdit();
      expect(vigie.gitFile).toHaveBeenCalledWith('s1', 'a.ts');
      expect(vm.draft()).toBe('export const a = 1;\n');
      vm.draft.set('saisie');
      idle.set(false);
      await vm.save();
      expect(vigie.writeFile).not.toHaveBeenCalled();
      expect(vm.editing()).not.toBeNull();
      expect(vm.draft()).toBe('saisie');
    });

    it('enregistre avec l’empreinte lue, sort du mode édition et recharge le diff', async () => {
      const { vm, vigie, resource } = setup([file()]);
      await vm.startEdit();
      vm.draft.set('');
      await vm.save();
      expect(vigie.writeFile).toHaveBeenCalledWith('s1', { path: 'a.ts', content: '', hash: 'a'.repeat(64) });
      expect(vm.editing()).toBeNull();
      expect(resource.reload).toHaveBeenCalled();
    });

    it('garde les fins de ligne CRLF du fichier (la textarea les normalise en LF)', async () => {
      const gitFile = vi.fn(async () => ({ path: 'a.ts', content: 'a\r\nb\r\n', hash: 'a'.repeat(64) }));
      const { vm, vigie } = setup([file()], { gitFile });
      await vm.startEdit();
      vm.draft.set('a\nb\nc\n');
      await vm.save();
      expect(vigie.writeFile).toHaveBeenCalledWith('s1', { path: 'a.ts', content: 'a\r\nb\r\nc\r\n', hash: 'a'.repeat(64) });
    });

    it('fichier modifié entre-temps : propose de recharger ; autre refus : bandeau d’erreur', async () => {
      const writeFile = vi.fn().mockRejectedValueOnce(httpError(412, 'Fichier modifié entre-temps')).mockRejectedValueOnce(httpError(409, 'Claude travaille dans cette session'));
      const { vm, vigie } = setup([file()], { writeFile });
      await vm.startEdit();
      vm.draft.set('saisie');
      await vm.save();
      expect(vm.conflict()).toBe(true);
      expect(vm.error()).toBeNull();
      expect(vm.draft()).toBe('saisie');
      await vm.load();
      expect(vigie.gitFile).toHaveBeenCalledTimes(2);
      expect(vm.conflict()).toBe(false);
      expect(vm.draft()).toBe('export const a = 1;\n');
      await vm.save();
      expect(vm.conflict()).toBe(false);
      expect(vm.error()).toBe('Claude travaille dans cette session');
      expect(vm.editing()).not.toBeNull();
    });

    it('changer de fichier quitte l’édition ; sans saisie, aucune question', async () => {
      const { vm } = setup([file(), file({ path: 'b.ts' })]);
      const ask = TestBed.inject(ConfirmService).ask;
      await vm.startEdit();
      expect(vm.dirty()).toBe(false);
      await vm.select('b.ts');
      expect(vm.editing()).toBeNull();
      await vm.select('a.ts');
      expect(vm.editing()).toBeNull();
      expect(ask).not.toHaveBeenCalled();
    });

    it('saisie non enregistrée : changer de fichier ou recharger demande confirmation, un refus la garde', async () => {
      const { vm, vigie } = setup([file(), file({ path: 'b.ts' })], {}, false);
      await vm.startEdit();
      vm.draft.set('saisie');
      expect(vm.dirty()).toBe(true);
      await vm.select('b.ts');
      expect(TestBed.inject(ConfirmService).ask).toHaveBeenCalledWith(DISCARD_EDIT);
      expect(vm.file()?.path).toBe('a.ts');
      expect(vm.draft()).toBe('saisie');
      await vm.load();
      expect(vigie.gitFile).toHaveBeenCalledTimes(1);
      expect(vm.draft()).toBe('saisie');
    });

    it('saisie non enregistrée : accepter l’abandon change de fichier', async () => {
      const { vm } = setup([file(), file({ path: 'b.ts' })]);
      await vm.startEdit();
      vm.draft.set('saisie');
      await vm.select('b.ts');
      expect(vm.file()?.path).toBe('b.ts');
      expect(vm.editing()).toBeNull();
      expect(vm.dirty()).toBe(false);
    });
  });
});
