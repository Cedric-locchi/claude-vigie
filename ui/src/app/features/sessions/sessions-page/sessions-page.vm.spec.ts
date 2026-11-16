import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { aSession, aSnapshot, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { ConfirmService } from '../../../core/confirm.service';
import { Router, provideRouter } from '@angular/router';
import { SessionsPageVm } from './sessions-page.vm';

const NOW = new Date('2026-11-08T15:00:00').getTime();

function createVm(sessions = [aSession()], sendKeys = vi.fn(), deleteSession = vi.fn(), confirmed = true, resumeSession = vi.fn(async () => ({})) as never) {
  TestBed.configureTestingModule({
    providers: [SessionsPageVm, provideRouter([]), provideConfirmServiceMock(confirmed), provideVigieServiceMock({ snapshot: signal(aSnapshot({ now: NOW, sessions })), sendKeys, deleteSession, resumeSession })],
  });
  return TestBed.inject(SessionsPageVm);
}

describe('SessionsPageVm', () => {
  it('trie par urgence : autorisations, fins de tour, en cours, terminées du jour', () => {
    const vm = createVm([
      aSession({ id: 'turn', state: 'turn', lastTs: NOW - 1000 }),
      aSession({ id: 'perm', state: 'waiting', reason: 'permission', lastTs: NOW - 5000 }),
      aSession({ id: 'run', state: 'running' }),
      aSession({ id: 'old', state: 'done', lastTs: NOW - 86_400_000 }),
      aSession({ id: 'today', state: 'done', lastTs: NOW - 60_000 }),
    ]);
    expect(vm.rows().map((r) => r.s.id)).toEqual(['perm', 'turn', 'run', 'today']);
    expect(vm.kpis()).toMatchObject({ blocked: 1, turn: 1, running: 1, subagents: 3, todayCost: 48.5 });
  });

  it("met l'activité de toutes les sessions à la même échelle et repère les sessions muettes", () => {
    const quiet = [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const busy = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
    const vm = createVm([aSession({ id: 'q', activity: quiet, lastTs: NOW - 1 }), aSession({ id: 'b', activity: busy })]);
    const [q, b] = vm.rows();
    expect(q.spark[0]).toBe(11);
    expect(b.spark[14]).toBe(22);
    expect(q.stale).toBe(true);
    expect(b.stale).toBe(false);
  });

  it('filtre par titre, projet ou branche', () => {
    const vm = createVm([aSession({ id: 'a', project: 'revu' }), aSession({ id: 'b', project: 'blog', branch: 'draft/spartan' })]);
    vm.setSearch('spartan');
    expect(vm.running().map((s) => s.id)).toEqual(['b']);
  });

  it('envoie la touche au terminal de la session', () => {
    const sendKeys = vi.fn();
    const vm = createVm([], sendKeys);
    vm.allow(aSession({ terminalId: 't1' }));
    vm.refuse(aSession({ terminalId: 't1' }));
    vm.allow(aSession({ terminalId: null }));
    expect(sendKeys.mock.calls).toEqual([['t1', '\r'], ['t1', '\x1b']]);
  });

  it('Autoriser / Refuser en échec : erreur sur la ligne de la session, effacée au nouvel essai', async () => {
    const sendKeys = vi.fn(async () => { throw { status: 500, error: { error: 'PTY fermé' } }; });
    const vm = createVm([], sendKeys);
    await vm.allow(aSession({ id: 'a', terminalId: 't1' }));
    expect(vm.replyError()).toEqual({ id: 'a', message: "Impossible d'envoyer la réponse au terminal : PTY fermé. Réessaie." });
    sendKeys.mockResolvedValueOnce({ ok: true } as never);
    await vm.refuse(aSession({ id: 'a', terminalId: 't1' }));
    expect(vm.replyError()).toBeNull();
  });

  it('premier lancement : après 5 s sans snapshot ni connexion, explique quoi faire ; un snapshot tardif reprend la main', () => {
    vi.useFakeTimers();
    try {
      const snapshot = signal<ReturnType<typeof aSnapshot> | null>(null);
      const connected = signal(false);
      TestBed.configureTestingModule({ providers: [SessionsPageVm, provideRouter([]), provideConfirmServiceMock(), provideVigieServiceMock({ snapshot, connected })] });
      const vm = TestBed.inject(SessionsPageVm);
      expect([vm.loading(), vm.unreachable()]).toEqual([true, false]);
      vi.advanceTimersByTime(5000);
      expect(vm.unreachable()).toBe(true);
      snapshot.set(aSnapshot());
      expect([vm.loading(), vm.unreachable()]).toEqual([false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('supprime une session seulement après confirmation', async () => {
    const deleteSession = vi.fn();
    await createVm([], vi.fn(), deleteSession, false).remove(aSession({ id: 'x' }));
    expect(deleteSession).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    await createVm([], vi.fn(), deleteSession, true).remove(aSession({ id: 'x' }));
    expect(deleteSession).toHaveBeenCalledWith('x');
  });

  it('reprend une session externe puis ouvre sa page, seulement si confirmé', async () => {
    const resumeSession = vi.fn(async () => ({}));
    const vm = createVm([aSession()], vi.fn(), vi.fn(), true, resumeSession as never);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await vm.resume(aSession({ id: 'ext', terminalId: null }));
    expect(resumeSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'ext' }));
    expect(navigate).toHaveBeenCalledWith(['/sessions', 'ext']);
  });

  it("un clic sur la ligne ouvre la session, sauf sur un bouton ou un lien", () => {
    const vm = createVm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const cell = document.createElement('span');
    vm.openRow({ target: cell, view: null } as unknown as MouseEvent, 's1');
    expect(navigate).toHaveBeenCalledWith(['/sessions', 's1']);
    navigate.mockClear();
    const btn = document.createElement('button');
    vm.openRow({ target: btn, view: null } as unknown as MouseEvent, 's1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('coche, tout sélectionne sur les lignes visibles et oublie les sessions filtrées', () => {
    const vm = createVm([aSession({ id: 'a', title: 'alpha' }), aSession({ id: 'b', title: 'beta' })]);
    vm.toggle('a', true);
    expect(vm.selected().map((s) => s.id)).toEqual(['a']);
    expect(vm.someSelected()).toBe(true);
    vm.toggleAll(true);
    expect(vm.allSelected()).toBe(true);
    vm.setSearch('beta');
    expect(vm.selected().map((s) => s.id)).toEqual(['b']);
    vm.toggle('b', false);
    expect(vm.selected()).toEqual([]);
    expect(vm.allSelected()).toBe(false);
  });

  it("cocher une case n'ouvre pas la session", () => {
    const vm = createVm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const box = document.createElement('button');
    box.setAttribute('role', 'checkbox');
    vm.openRow({ target: box, view: null } as unknown as MouseEvent, 's1');
    vm.openRow({ target: document.createElement('input'), view: null } as unknown as MouseEvent, 's1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('supprime la sélection après une seule confirmation, une erreur ne bloque pas les autres', async () => {
    const sessions = [aSession({ id: 'a', terminalId: null }), aSession({ id: 'b', terminalId: 't1' }), aSession({ id: 'c', terminalId: null })];
    const refused = vi.fn();
    let vm = createVm(sessions, vi.fn(), refused, false);
    vm.toggleAll(true);
    await vm.removeSelected();
    expect(refused).not.toHaveBeenCalled();
    expect(vm.selected()).toHaveLength(3);
    TestBed.resetTestingModule();

    const deleteSession = vi.fn(async (id: string) => (id === 'b' ? Promise.reject(new Error('500')) : {}));
    vm = createVm(sessions, vi.fn(), deleteSession, true);
    vm.toggleAll(true);
    await vm.removeSelected();
    expect(TestBed.inject(ConfirmService).deleteSessions).toHaveBeenCalledWith(3, true);
    expect(deleteSession.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
    expect(vm.selected().map((s) => s.id)).toEqual(['b']); // l'échec reste coché pour réessayer
    vm.clearSelection();
    expect(vm.selected()).toEqual([]);
  });
});
