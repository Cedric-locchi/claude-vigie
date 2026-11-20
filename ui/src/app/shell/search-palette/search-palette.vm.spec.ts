import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSearch } from '../../core/models';
import { SEARCH_DELAY, VigieService } from '../../core/vigie.service';
import { aSession, aSessionSearch, aSnapshot, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { SearchPaletteVm } from './search-palette.vm';

const SESSIONS = [aSession({ id: 's1', title: 'Moteur de suggestions', project: 'meeplebox', state: 'waiting', reason: 'question' }), aSession({ id: 's2', title: 'npm audit', project: 'vigie', state: 'done' })];

function setup(extra: Partial<VigieService> = {}) {
  TestBed.configureTestingModule({ providers: [SearchPaletteVm, provideRouter([]), provideVigieServiceMock({ snapshot: signal(aSnapshot({ sessions: SESSIONS })), ...extra })] });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { vm: TestBed.inject(SearchPaletteVm), vigie: TestBed.inject(VigieService), navigate };
}

/** Saisie puis attente (fausse horloge) ; les effets (debounced, resource) passent à chaque tick. */
async function type(vm: SearchPaletteVm, q: string, wait = SEARCH_DELAY) {
  vm.query.set(q);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(wait);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(0);
  TestBed.tick();
}

describe('SearchPaletteVm', () => {
  afterEach(() => vi.useRealTimers());

  it('une requête 250 ms après la dernière frappe, terme sans les blancs ; rien sous 2 caractères', async () => {
    vi.useFakeTimers();
    const { vm, vigie } = setup();
    await type(vm, ' n ', 1000);
    expect(vm.summary()).toEqual({ text: 'Tape au moins 2 caractères.' });
    expect(vigie.searchSessions).not.toHaveBeenCalled();

    await type(vm, ' np', 100);
    await type(vm, ' npm ', SEARCH_DELAY - 10);
    expect(vigie.searchSessions).not.toHaveBeenCalled();
    expect(vm.summary()).toEqual({ text: 'Recherche…' });
    await type(vm, ' npm ', 10);
    expect(vigie.searchSessions).toHaveBeenCalledTimes(1);
    expect(vigie.searchSessions).toHaveBeenCalledWith('npm', expect.any(AbortSignal));
    expect(vm.summary()).toEqual({ text: '2 sessions' });

    await type(vm, 'n', 0); // repasse sous le minimum : résultats retirés tout de suite, sans requête
    expect(vm.rows()).toEqual([]);
    expect(vigie.searchSessions).toHaveBeenCalledTimes(1);
  });

  it('jointure avec le snapshot : ordre du daemon, session inconnue ignorée, 3 extraits au plus ; ligne trouvée par son seul titre', async () => {
    vi.useFakeTimers();
    const hit = (n: number, at: number | null = 0) => ({ id: `S:${n}`, ts: new Date(2026, 10, 20, 14, n).getTime(), kind: 'tool' as const, title: `Bash · npm ${n}`, agent: 'Agent principal', sub: false, text: at === null ? '' : 'npm test', at });
    const found: SessionSearch = {
      sessions: [
        { id: 's2', count: 0, hits: [] },
        { id: 'gone', count: 1, hits: [hit(9)] },
        { id: 's1', count: 12, hits: [hit(5, null), hit(4), hit(3), hit(2), hit(1)] },
      ],
      truncated: true,
    };
    const { vm } = setup({ searchSessions: vi.fn(async () => found) });
    await type(vm, 'npm');
    const rows = vm.rows();
    expect(rows.map((r) => [r.id, r.title, r.project, r.state, r.found])).toEqual([
      ['s2', 'npm audit', 'vigie', 'done', 'Titre'],
      ['s1', 'Moteur de suggestions', 'meeplebox', 'waiting', '12 lignes'],
    ]);
    expect(rows[1].stateLabel).toBe('Question');
    expect(rows[1].hits).toEqual([
      { id: 'S:5', kind: 'Outil', time: '14:05', parts: { pre: 'Bash · npm 5', hit: '', post: '' } }, // terme dans le titre de la ligne seulement
      { id: 'S:4', kind: 'Outil', time: '14:04', parts: { pre: '', hit: 'npm', post: ' test' } },
      { id: 'S:3', kind: 'Outil', time: '14:03', parts: { pre: '', hit: 'npm', post: ' test' } },
    ]);
    expect(vm.truncated()).toBe(true);
    expect(vm.summary()).toEqual({ text: '2 sessions' });
  });

  it('un nouveau terme coupe la requête précédente ; sa réponse tardive n’est jamais affichée', async () => {
    vi.useFakeTimers();
    const calls: { q: string; signal: AbortSignal; resolve: (r: SessionSearch) => void }[] = [];
    const { vm } = setup({ searchSessions: vi.fn((q: string, signal?: AbortSignal) => new Promise<SessionSearch>((resolve) => calls.push({ q, signal: signal!, resolve }))) });
    await type(vm, 'np');
    await type(vm, 'npm');
    expect(calls.map((c) => c.q)).toEqual(['np', 'npm']);
    expect([calls[0].signal.aborted, calls[1].signal.aborted]).toEqual([true, false]);
    calls[1].resolve(aSessionSearch({ sessions: [{ id: 's2', count: 0, hits: [] }] }));
    await type(vm, 'npm', 0);
    calls[0].resolve(aSessionSearch());
    await type(vm, 'npm', 0);
    expect(vm.rows().map((r) => r.id)).toEqual(['s2']);
  });

  it('erreur du daemon : message, aucun résultat', async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => aSessionSearch());
    const { vm } = setup({ searchSessions: search });
    await type(vm, 'npm');
    expect(vm.rows()).toHaveLength(2);
    search.mockRejectedValueOnce(Object.assign(new Error('http'), { status: 400, error: { error: '200 caractères au plus' } }));
    await type(vm, 'npm t');
    expect(vm.error()).toBe('200 caractères au plus');
    expect(vm.summary()).toEqual({ text: '200 caractères au plus', err: true });
    expect(vm.rows()).toEqual([]); // pas les résultats d'avant sous un message d'erreur
    search.mockRejectedValueOnce(Object.assign(new Error('http'), { status: 0 }));
    await type(vm, 'npm te');
    expect(vm.error()).toBe('Le daemon ne répond pas');
  });

  it('↑↓ circulaires, remis à la première option à chaque réponse ; Entrée ouvre le Journal filtré sur le terme de la réponse affichée', async () => {
    vi.useFakeTimers();
    const { vm, navigate } = setup();
    expect(vm.key('Enter')).toBeNull(); // rien à ouvrir
    await type(vm, 'npm');
    expect(vm.index()).toBe(0);
    expect(vm.key('ArrowUp')).toBe('move');
    expect(vm.index()).toBe(1);
    expect(vm.key('ArrowDown')).toBe('move');
    expect(vm.index()).toBe(0);
    vm.key('ArrowDown');
    await type(vm, 'npm t'); // nouvelle réponse
    expect(vm.index()).toBe(0);
    vm.key('ArrowDown');
    vm.query.set('npm test plus long'); // saisie en cours : la réponse affichée reste celle de « npm t »
    TestBed.tick();
    expect(vm.key('Enter')).toBe('pick');
    expect(navigate).toHaveBeenCalledWith(['/sessions', 's2'], { queryParams: { log: 'npm t' } });
    expect(vm.key('a')).toBeNull();
  });
});
