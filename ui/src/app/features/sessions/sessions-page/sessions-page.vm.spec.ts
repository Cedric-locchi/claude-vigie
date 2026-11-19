import { TestBed } from '@angular/core/testing';
import { Signal, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { aSession, aSettings, aSnapshot, aUsageRows, anUsageRow, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { VigieService } from '../../../core/vigie.service';
import { addDays, startOfDay } from '../../usage/usage-series';
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
  it('une seule liste par date de création décroissante, quel que soit l’état ; terminées du jour seulement', () => {
    const vm = createVm([
      aSession({ id: 'turn', state: 'turn', lastTs: NOW - 1000, firstTs: 3000 }),
      aSession({ id: 'perm', state: 'waiting', reason: 'permission', lastTs: NOW - 5000, firstTs: 1000 }),
      aSession({ id: 'run', state: 'running', firstTs: 2000 }),
      aSession({ id: 'old', state: 'done', lastTs: NOW - 86_400_000 }),
      aSession({ id: 'today', state: 'done', lastTs: NOW - 60_000, firstTs: 4000 }),
    ]);
    expect(vm.rows().map((r) => r.s.id)).toEqual(['today', 'turn', 'run', 'perm']);
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

  it('la sélection porte sur toute la liste, attentes comprises', () => {
    const vm = createVm([
      aSession({ id: 'perm', state: 'waiting', reason: 'permission', lastTs: NOW - 5000 }),
      aSession({ id: 'turn', state: 'turn', lastTs: NOW - 1000 }),
      aSession({ id: 'run', state: 'running' }),
      aSession({ id: 'today', state: 'done', lastTs: NOW - 60_000 }),
    ]);
    vm.toggleAll(true);
    expect(vm.selected().map((s) => s.id)).toEqual(['perm', 'turn', 'run', 'today']);
    expect(vm.kpis().sessionBar).toEqual(['wait', 'turn', 'on', 'ok']);
  });

  it('une session qui change d’état garde sa place dans la liste et sa sélection', () => {
    const run = (state: 'running' | 'turn' | 'waiting') => [
      aSession({ id: 'new', state: 'running', firstTs: 3000 }),
      aSession({ id: 'mid', state, firstTs: 2000 }),
      aSession({ id: 'old', state: 'running', firstTs: 1000 }),
    ];
    const snapshot = signal(aSnapshot({ now: NOW, sessions: run('running') }));
    TestBed.configureTestingModule({ providers: [SessionsPageVm, provideRouter([]), provideConfirmServiceMock(), provideVigieServiceMock({ snapshot })] });
    const vm = TestBed.inject(SessionsPageVm);
    vm.toggle('mid', true);
    for (const state of ['turn', 'waiting'] as const) {
      snapshot.set(aSnapshot({ now: NOW, sessions: run(state) }));
      expect(vm.rows().map((r) => r.s.id)).toEqual(['new', 'mid', 'old']);
      expect(vm.selected().map((s) => s.id)).toEqual(['mid']);
    }
  });

  it('historique : 53 semaines fixes (heatmap la plus large) ; moyenne 7 j', () => {
    const today = startOfDay(NOW);
    const rows = aUsageRows({
      now: NOW,
      rows: [
        anUsageRow({ day: addDays(today, -1), model: 'claude-opus-5-5', input: 0, output: 7000, cacheCreate: 0, cacheRead: 0, cost: 14 }),
        anUsageRow({ day: addDays(today, -3), model: 'claude-sonnet-5-5', input: 0, output: 21_000, cacheCreate: 0, cacheRead: 0, cost: 7 }),
        anUsageRow({ day: addDays(today, -100), model: 'claude-opus-5-5', input: 0, output: 1000, cacheCreate: 0, cacheRead: 0, cost: 1 }),
      ],
    });
    let days: Signal<number> | null = null;
    TestBed.configureTestingModule({
      providers: [SessionsPageVm, provideRouter([]), provideConfirmServiceMock(), provideVigieServiceMock({
        snapshot: signal(aSnapshot({ now: NOW })),
        usageResource: ((d: Signal<number>) => { days = d; return fakeResource(rows); }) as unknown as VigieService['usageResource'],
        settingsResource: (() => fakeResource(aSettings({ alerts: { dailyCost: 40, windowPct: null } }))) as unknown as VigieService['settingsResource'],
      })],
    });
    const vm = TestBed.inject(SessionsPageVm);
    expect(days!()).toBe(371);
    expect(vm.kpis().avg).toEqual({ cost: 3, tokens: 4000 });
    expect(vm.kpis().costTrend).toBe('up'); // 48,50 $ aujourd'hui pour 3 $ de moyenne
    // Coût du jour 48,50 $ au-dessus du seuil de 40 $ : toute la barre en rouge.
    expect(new Set(vm.kpis().costBar)).toEqual(new Set(['hot']));
    expect(vm.kpis().window?.bar.filter((x) => x === 'on')).toHaveLength(12); // 62 % de 20 tirets
    expect(vm.activity()?.peak?.tokens).toBe(21_000);
    // La heatmap suit la largeur : 26 semaines incluent le jour d'il y a 100 jours, 13 non ; même historique.
    expect(vm.activity()?.activeDays).toBe(3);
    vm.activityWeeks.set(13);
    expect(vm.activity()?.activeDays).toBe(2);
    expect(vm.activity()?.weeks).toHaveLength(13);
    expect(days!()).toBe(371);
  });
});
