import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { DOCUMENT, Signal, WritableSignal, computed, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { Agent, SessionDetail, SessionPlugin, Snapshot, Terminal } from '../../../core/models';
import { aGitDiff, aSession, aSessionUsage, aSnapshot, aTerminal, anAgent as mockAgent, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { OUTDATED, VigieService } from '../../../core/vigie.service';
import { Router, provideRouter } from '@angular/router';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { ConfirmService } from '../../../core/confirm.service';
import { CLIENT_OS } from '../../../core/platform';
import { DISCARD_EDIT } from '../diff/session-diff.vm';
import { SessionPageVm } from './session-page.vm';

const term = (id: string, kind: Terminal['kind']): Terminal => aTerminal({ id, kind, title: kind });
const anAgent = (extra: Partial<Agent>): Agent => mockAgent({ name: 'Agent principal', tokens: 0, toolCount: 0, firstTs: 0, lastTs: 0, ...extra });

function createVm(agents: Agent[] = [], sendKeys = vi.fn(), openShell = vi.fn(async () => term('t3', 'shell')), closeTerminal = vi.fn(async () => ({ ok: true })), summary = aSession()) {
  const detail: SessionDetail = { summary, agents, timeline: { start: 0, end: 100 }, usage: aSessionUsage() };
  const open = vi.fn();
  const deleteSession = vi.fn(async () => ({ ok: true }));
  TestBed.configureTestingModule({
    providers: [
      SessionPageVm, provideRouter([]), provideConfirmServiceMock(), { provide: CLIENT_OS, useValue: 'linux' },
      { provide: DOCUMENT, useValue: { defaultView: { open }, location: { protocol: 'http:', host: 'x' }, addEventListener: vi.fn(), removeEventListener: vi.fn(), hasFocus: () => false } },
      provideVigieServiceMock({
        snapshot: signal(aSnapshot({ terminals: [term('t1', 'claude'), term('t2', 'shell')] })),
        sessionResource: () => fakeResource(detail),
        sendKeys, openShell, deleteSession, closeTerminal,
      }),
    ],
  });
  const vm = TestBed.inject(SessionPageVm);
  vm.connect(signal('s1'));
  return { vm, open, deleteSession };
}

describe('SessionPageVm', () => {
  it('distingue une session introuvable d’un détail hors contrat', () => {
    const vmWith = (error: Error) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
          provideVigieServiceMock({ sessionResource: () => fakeResource(undefined, 'error', error) })],
      });
      const vm = TestBed.inject(SessionPageVm);
      vm.connect(signal('s1'));
      return vm;
    };
    const outdated = vmWith(new Error(OUTDATED));
    expect([outdated.notFound(), outdated.outdated()]).toEqual([true, true]);
    const missing = vmWith(new Error('Http failure response: 404 Not Found'));
    expect([missing.notFound(), missing.outdated()]).toEqual([true, false]);
  });

  it('ouvre sur le terminal claude et liste les onglets de la session', () => {
    const { vm } = createVm();
    expect(vm.terminals().map((t) => t.id)).toEqual(['t1', 't2']);
    expect(vm.activeTab()).toBe('t1');
    vm.selectTab('t2');
    expect(vm.activeTerminal()?.kind).toBe('shell');
  });

  it("badge d'état de la session et nombre d'agents en souci", () => {
    const label = (summary: ReturnType<typeof aSession>) => {
      TestBed.resetTestingModule();
      return createVm([], undefined, undefined, undefined, summary).vm.stateBadge();
    };
    expect(label(aSession({ state: 'waiting', reason: 'permission' }))).toEqual({ variant: 'waiting', label: 'Attend ton autorisation' });
    expect(label(aSession({ state: 'waiting', reason: 'question' }))!.label).toBe('Attend ta réponse');
    expect(label(aSession({ state: 'turn' }))!.label).toBe('À toi');
    expect(label(aSession({ state: 'running' }))!.label).toBe('En cours');
    expect(label(aSession({ state: 'done' }))!.label).toBe('Terminée');
    TestBed.resetTestingModule();
    const { vm } = createVm([anAgent({ state: 'waiting' }), anAgent({ id: 'b', sub: true, state: 'done', issue: '2 snapshots obsolètes' })]);
    expect(vm.issues()).toBe(1);
  });

  it('un agent en attente reste visible avec le filtre par défaut', () => {
    const { vm } = createVm([anAgent({ id: 'w', sub: true, state: 'waiting' }), anAgent({ state: 'running' })]);
    expect(vm.visibleAgents().map((a) => a.id)).toContain('w');
    vm.filterAgents('done'); // aucun terminé : retour au défaut
    expect(vm.visibleAgents().map((a) => a.id)).toContain('w');
  });

  it("barre d'attente : seulement si la session attend et qu'un terminal claude peut répondre", () => {
    const bar = (summary: ReturnType<typeof aSession>) => {
      TestBed.resetTestingModule();
      return createVm([], undefined, undefined, undefined, summary).vm.waitBar();
    };
    expect(bar(aSession({ state: 'waiting', reason: 'permission', detail: 'Bash · rm -rf dist' }))).toEqual({ question: false, canAllow: true, detail: 'Bash · rm -rf dist' });
    expect(bar(aSession({ state: 'waiting', reason: 'question', detail: 'Imports ou nommage ?' }))).toEqual({ question: true, canAllow: false, detail: 'Imports ou nommage ?' });
    expect(bar(aSession({ state: 'running' }))).toBeNull();
  });

  it('compteur du Diff : git relu à l’ouverture et en fin de tour, pas à chaque événement', () => {
    let version: Signal<number> | undefined;
    const snapshot = signal(aSnapshot({ terminals: [term('t1', 'claude')], sessions: [aSession({ state: 'running' })] }));
    const file = { status: 'M', staged: false, unstaged: true, added: 1, removed: 0, patch: '', truncated: false } as const;
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({
          snapshot,
          gitResource: (_id, v) => {
            version = v;
            return fakeResource(aGitDiff({ files: [{ ...file, path: 'a.ts' }, { ...file, path: 'b.ts' }] }));
          },
        })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect(vm.diffCount()).toBe(2);
    const versions = new Set([version!()]);
    const at = (state: 'running' | 'turn', lastTs: number) => {
      snapshot.set(aSnapshot({ terminals: [term('t1', 'claude')], sessions: [aSession({ state, lastTs })] }));
      versions.add(version!());
    };
    at('running', 70_000);
    at('running', 80_000);
    expect(versions.size).toBe(1); // l'activité seule ne relance pas git
    at('turn', 90_000);
    expect(versions.size).toBe(2); // fin de tour : nouvelle version
  });

  it('onglets de plugin : listés tant que des plugins sont actifs, jamais retenus comme dernière vue, retirés avec le plugin', () => {
    let id: Signal<string | null> | undefined;
    const snapshot = signal(aSnapshot({ terminals: [term('t1', 'claude')], plugins: ['mise'] }));
    const list = fakeResource<SessionPlugin[] | undefined>([{ id: 'mise', name: 'Tâches mise', badge: '2' }]);
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({ snapshot, sessionPluginsResource: (s) => ((id = s), list) })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect(vm.plugins()).toEqual([{ id: 'mise', name: 'Tâches mise', badge: '2' }]);
    expect(id!()).toBe('s1');
    vm.showView('history');
    TestBed.tick();
    vm.showView('plugin:mise');
    TestBed.tick();
    expect(vm.view()).toBe('plugin:mise');
    const next = TestBed.runInInjectionContext(() => new SessionPageVm());
    next.connect(signal('s1'));
    expect(next.view()).toBe('history'); // l'onglet du plugin n'a pas remplacé la dernière vue
    list.set([]); // plugin désactivé, ou projet qui ne s'y prête plus : retour au terminal
    TestBed.tick();
    expect(vm.view()).toBe('workspace');
    snapshot.set(aSnapshot({ terminals: [term('t1', 'claude')], plugins: [] }));
    list.set([{ id: 'mise', name: 'Tâches mise', badge: '2' }]);
    expect(vm.plugins()).toEqual([]); // aucun plugin actif : pas d'onglet, même avec une ancienne liste
  });

  /** VM avec plugins actifs et une détection espionnée (id de session demandé au daemon). */
  function pluginVm(snapshot: WritableSignal<Snapshot>, summary = aSession()) {
    let id: Signal<string | null> | undefined;
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({
          snapshot,
          sessionResource: () => fakeResource<SessionDetail | undefined>({ summary, agents: [], timeline: { start: 0, end: 1 }, usage: aSessionUsage() }),
          sessionPluginsResource: (s) => ((id = s), fakeResource(computed(() => (s() ? [{ id: 'npm', name: 'npm' }] : undefined)))),
        })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    return { vm, id: () => id!() };
  }

  it('onglets de plugin : aussi pour une session lancée hors de Vigie ; une action y ouvre le terminal sans perdre les onglets', () => {
    const snapshot = signal(aSnapshot({ terminals: [], plugins: ['npm'] }));
    const { vm, id } = pluginVm(snapshot);
    expect(vm.isExternal()).toBe(true);
    expect(vm.plugins()).toEqual([{ id: 'npm', name: 'npm' }]);
    expect(id()).toBe('s1');
    vm.showView('plugin:npm');
    TestBed.tick();
    // L'action répond avec le terminal ouvert (`opened`) avant ou après le snapshot qui le contient : il est sélectionné dans les deux cas.
    vm.selectTab('t9');
    expect(vm.view()).toBe('workspace');
    snapshot.set(aSnapshot({ terminals: [{ ...term('t9', 'shell'), title: 'npm run test' }], plugins: ['npm'] }));
    TestBed.tick();
    expect(vm.isExternal()).toBe(false); // la mise en page passe en mode terminal
    expect(vm.activeTerminal()?.id).toBe('t9');
    expect(vm.plugins()).toEqual([{ id: 'npm', name: 'npm' }]); // l'onglet du plugin reste
    expect(id()).toBe('s1');
  });

  it('onglets de plugin : aucune détection pour une discussion', () => {
    const { vm, id } = pluginVm(signal(aSnapshot({ terminals: [term('t1', 'claude')], plugins: ['npm'] })), aSession({ cwd: '/Users/x/.vigie/chat' }));
    expect(vm.isChat()).toBe(true);
    expect(vm.plugins()).toEqual([]);
    expect(id()).toBeNull();
  });

  it('filtre les agents par état ; recliquer retire le filtre', () => {
    const { vm } = createVm([anAgent({ state: 'running' }), anAgent({ id: 'b', sub: true, state: 'done' }), anAgent({ id: 'c', sub: true, state: 'done' })]);
    expect(vm.agentFilters().map((f) => [f.state, f.count])).toEqual([['running', 1], ['done', 2]]);
    expect(vm.activeAgentFilter()).toBe('running'); // par défaut : « Non terminés » s'il y en a
    vm.filterAgents('done');
    expect(vm.visibleAgents().map((a) => a.id)).toEqual(['b', 'c']);
    vm.filterAgents('done');
    expect(vm.visibleAgents()).toHaveLength(3);
    vm.filterAgents('waiting'); // aucun agent dans cet état : on retombe sur le défaut
    expect(vm.activeAgentFilter()).toBe('running');
  });

  it('« Non terminés » inclut les agents « à toi » et reste le filtre par défaut', () => {
    const { vm } = createVm([anAgent({ state: 'turn' }), anAgent({ id: 'b', sub: true, state: 'running' }), anAgent({ id: 'c', sub: true, state: 'done' })]);
    expect(vm.agentFilters().map((f) => [f.state, f.count])).toEqual([['running', 2], ['done', 1]]);
    expect(vm.activeAgentFilter()).toBe('running');
    expect(vm.visibleAgents().map((a) => a.id)).toEqual(['main', 'b']);
  });

  it('ni actif ni « à toi » : « tous » par défaut', () => {
    expect(createVm([anAgent({ state: 'done' })]).vm.activeAgentFilter()).toBeNull();
  });

  it('contexte : utilisé / max ; /compact bloqué pendant une autorisation, permis sinon (même session « terminée »)', () => {
    vi.useFakeTimers();
    try {
      const sendKeys = vi.fn();
      const { vm } = createVm([], sendKeys, undefined, undefined, aSession({ state: 'waiting' }));
      expect(vm.context()).toEqual({ used: 800, max: 200_000, pct: 800 / 200_000, level: 'ok' });
      vm.compact(); // autorisation en cours : Entrée l'accepterait, rien n'est tapé
      expect(sendKeys).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
      const idle = createVm([], sendKeys, undefined, undefined, aSession({ state: 'done' })).vm;
      idle.compact();
      vi.advanceTimersByTime(150);
      expect(sendKeys.mock.calls).toEqual([['t1', '/compact'], ['t1', '\r']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('worktree : demande tapée à Claude puis Entrée à part, jamais pendant une autorisation', () => {
    vi.useFakeTimers();
    try {
      const sendKeys = vi.fn();
      createVm([], sendKeys, undefined, undefined, aSession({ state: 'waiting' })).vm.enterWorktree('x');
      expect(sendKeys).not.toHaveBeenCalled();
      TestBed.resetTestingModule();
      createVm([], sendKeys, undefined, undefined, aSession({ state: 'turn' })).vm.enterWorktree('feat/x');
      vi.advanceTimersByTime(150);
      expect(sendKeys.mock.calls[0][1]).toContain('EnterWorktree');
      expect(sendKeys.mock.calls[0][1]).toContain('feat/x');
      expect(sendKeys.mock.calls[1]).toEqual(['t1', '\r']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Interrompre : seulement pendant que Claude répond', () => {
    expect(createVm([], vi.fn(), undefined, undefined, aSession({ state: 'running' })).vm.canInterrupt()).toBe(true);
    TestBed.resetTestingModule();
    expect(createVm([], vi.fn(), undefined, undefined, aSession({ state: 'turn' })).vm.canInterrupt()).toBe(false);
  });

  it('tape la réponse dans le terminal claude et y ramène', () => {
    const sendKeys = vi.fn();
    const { vm } = createVm([], sendKeys);
    vm.selectTab('t2');
    vm.allow();
    vm.interrupt();
    expect(sendKeys.mock.calls).toEqual([['t1', '\r'], ['t1', '\x1b']]);
    expect(vm.activeTab()).toBe('t1');
  });

  it('Autoriser en échec : message sur la barre, effacé au nouvel essai et en changeant de session', async () => {
    const sendKeys = vi.fn(async () => { throw { status: 0 }; });
    const { vm } = createVm([], sendKeys);
    await vm.allow();
    expect(vm.replyError()).toMatch(/^Impossible d'envoyer la réponse au terminal : le daemon ne répond pas\. Réessaie\.$/);
    sendKeys.mockResolvedValueOnce({ ok: true } as never);
    await vm.refuse();
    expect(vm.replyError()).toBeNull();
    await vm.allow();
    expect(vm.replyError()).not.toBeNull();
    vm.connect(signal('s2')); // autre session : l'erreur ne la suit pas
    expect(vm.replyError()).toBeNull();
  });

  it('ouvre un shell dans le dossier et le sélectionne', async () => {
    const { vm } = createVm();
    await vm.addShell();
    expect(vm.activeTab()).toBe('t3');
  });

  it("ferme un onglet shell et revient au terminal claude", async () => {
    const closeTerminal = vi.fn(async () => ({ ok: true }));
    const { vm } = createVm([], vi.fn(), undefined, closeTerminal);
    vm.selectTab('t2');
    await vm.closeTab('t2');
    expect(closeTerminal).toHaveBeenCalledWith('t2');
    expect(vm.activeTab()).toBe('t1');
  });

  it('shell ouvert ou fermé en échec : la raison sous l’en-tête, effacée au nouvel essai', async () => {
    const openShell = vi.fn().mockRejectedValueOnce(new HttpErrorResponse({ status: 0 })).mockResolvedValueOnce(term('t3', 'shell'));
    const closeTerminal = vi.fn().mockRejectedValueOnce(new HttpErrorResponse({ status: 404, error: { error: 'terminal inconnu' } }));
    const { vm } = createVm([], vi.fn(), openShell, closeTerminal);
    await vm.addShell();
    expect([vm.replyError(), vm.activeTab()]).toEqual(['Le daemon ne répond pas', 't1']);
    await vm.addShell();
    expect([vm.replyError(), vm.activeTab()]).toEqual([null, 't3']);
    await vm.closeTab('t2');
    expect(vm.replyError()).toBe('Terminal inconnu');
  });

  it('suppression en échec : la raison sous l’en-tête, on reste sur la page', async () => {
    const { vm, deleteSession } = createVm();
    deleteSession.mockRejectedValueOnce(new Error('réseau'));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await vm.remove();
    expect(vm.replyError()).toBe('Suppression impossible.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('détache un terminal dans une fenêtre', () => {
    const { vm, open } = createVm();
    vm.detach('t1');
    expect(open).toHaveBeenCalledWith('/terminal/t1', 'vigie-t1', expect.any(String));
  });

  it('supprime la session puis revient à la liste', async () => {
    const { vm, deleteSession } = createVm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await vm.remove();
    expect(deleteSession).toHaveBeenCalledWith('s1');
    expect(navigate).toHaveBeenCalledWith(['/']);
  });

  it('supprimer avec une saisie non enregistrée : abandon demandé avant la suppression, refusé = rien ne se passe', async () => {
    const { vm, deleteSession } = createVm();
    vm.connect(signal('s1'), { diff: signal(true), files: signal(false) });
    const confirm = TestBed.inject(ConfirmService);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.mocked(confirm.ask).mockResolvedValueOnce(false);
    await vm.remove();
    expect(confirm.ask).toHaveBeenCalledWith(DISCARD_EDIT);
    expect([confirm.deleteSession, deleteSession, navigate].map((f) => vi.mocked(f).mock.calls.length)).toEqual([0, 0, 0]);
    await vm.remove(); // abandon accepté, suppression confirmée
    expect(deleteSession).toHaveBeenCalledWith('s1');
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(await vm.leave()).toBe(true); // le garde de la route ne redemande pas
    expect(confirm.ask).toHaveBeenCalledTimes(2);
  });

  it("rechargement ou fermeture de la fenêtre : le navigateur demande confirmation seulement s'il y a une saisie non enregistrée", () => {
    const { vm } = createVm();
    const diff = signal(false), files = signal(false);
    vm.connect(signal('s1'), { diff, files });
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      vm.beforeUnload(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    files.set(true);
    expect(unload()).toBe(true);
    files.set(false);
    diff.set(true);
    expect(unload()).toBe(true);
  });

  it('discussion : la vue choisie reste quand la source de la vue est recalculée', () => {
    const loading = signal<'resolved' | 'loading'>('resolved');
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({
          snapshot: signal(aSnapshot({ terminals: [term('t1', 'claude')], sessions: [aSession({ cwd: '/Users/x/.vigie/chat' })] })),
          sessionPluginsResource: () => fakeResource<SessionPlugin[] | undefined>(undefined, loading),
        })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect(vm.view()).toBe('workspace');
    vm.showView('usage');
    loading.set('loading');
    expect(vm.view()).toBe('usage');
    loading.set('resolved');
    expect(vm.view()).toBe('usage');
  });

  it('discussion : quitter la page efface la discussion ; une session normale passe sans rien effacer', async () => {
    const chat = createVm([], undefined, undefined, undefined, aSession({ cwd: '/Users/x/.vigie/chat' })).vm;
    expect(chat.isChat()).toBe(true);
    expect(await chat.leave()).toBe(true);
    const vigie = TestBed.inject(VigieService);
    expect(vigie.purgeChat).toHaveBeenCalledWith('s1');

    TestBed.resetTestingModule();
    const normal = createVm().vm;
    expect(normal.isChat()).toBe(false);
    expect(await normal.leave()).toBe(true);
    expect(TestBed.inject(VigieService).purgeChat).not.toHaveBeenCalled();
  });

  it("reste sur la page et signale l'erreur quand la purge d'une discussion échoue", async () => {
    const { vm } = createVm([], undefined, undefined, undefined, aSession({ cwd: '/Users/x/.vigie/chat' }));
    vi.mocked(TestBed.inject(VigieService).purgeChat).mockRejectedValueOnce(new Error('réseau'));
    expect(await vm.leave()).toBe(false);
    expect(vm.replyError()).toContain('n’a pas pu être supprimée');
    expect(await vm.leave()).toBe(true);
  });

  it("quitter la page avec une saisie non enregistrée (Diff ou Fichiers) demande confirmation", async () => {
    const { vm } = createVm();
    const diff = signal(true), files = signal(false);
    vm.connect(signal('s1'), { diff, files });
    expect(vm.diffUnsaved()).toBe(true); // l'onglet Diff reste monté
    const ask = vi.mocked(TestBed.inject(ConfirmService).ask);
    ask.mockResolvedValueOnce(false);
    expect(await vm.leave()).toBe(false);
    expect(await vm.leave()).toBe(true);
    diff.set(false);
    files.set(true);
    ask.mockResolvedValueOnce(false);
    expect(await vm.leave()).toBe(false);
    expect(ask).toHaveBeenCalledTimes(3);
    files.set(false);
    expect(await vm.leave()).toBe(true);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it("quitter la vue Fichiers avec un brouillon demande confirmation (bouton, raccourci, onglets, réponse rapide)", async () => {
    const { vm } = createVm();
    const files = signal(false);
    vm.connect(signal('s1'), { diff: signal(false), files });
    const ask = vi.mocked(TestBed.inject(ConfirmService).ask);
    vm.showView('history');
    await vm.toggleFiles();
    files.set(true);
    ask.mockResolvedValueOnce(false);
    await vm.toggleFiles(); // refusé : on reste, le brouillon aussi
    expect(vm.view()).toBe('files');
    ask.mockResolvedValueOnce(false);
    expect(await vm.showView('config')).toBe(false);
    ask.mockResolvedValueOnce(false);
    vm.goToTerminal();
    await Promise.resolve();
    expect(vm.view()).toBe('files');
    await vm.allow(); // la touche part, la vue ne change pas sans demander
    expect(vm.view()).toBe('files');
    expect(ask).toHaveBeenCalledTimes(3);
    ask.mockResolvedValueOnce(true);
    await vm.toggleFiles(); // abandon confirmé
    expect(vm.view()).toBe('history');
    vm.showView('workspace');
    TestBed.tick(); // remet la dernière vue du module pour les autres tests
  });

  it("« Voir dans le journal » : onglet Historique en mode Journal, recherche pré-remplie ; le même terme redemandé est réappliqué", async () => {
    const { vm } = createVm();
    expect(vm.historyMode()).toBe('timeline');
    await vm.openLog('Bash · npm test');
    expect([vm.view(), vm.historyMode(), vm.logQuery()]).toEqual(['history', 'log', { q: 'Bash · npm test' }]);
    const first = vm.logQuery();
    await vm.openLog('Bash · npm test');
    expect(vm.logQuery()).toEqual(first);
    expect(vm.logQuery()).not.toBe(first); // nouvel objet : le journal réapplique le terme
    vm.showView('workspace');
    TestBed.tick();
  });

  it('palette de recherche (?log=) : Historique > Journal filtré, paramètre retiré de l’URL ; confirmation si brouillon Fichiers', async () => {
    const { vm } = createVm();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const log = signal<string | undefined>(undefined), files = signal(false);
    vm.connect(signal('s1'), { diff: signal(false), files }, log);
    TestBed.tick();
    expect(navigate).not.toHaveBeenCalled();

    log.set('npm test');
    TestBed.tick();
    expect(navigate).toHaveBeenCalledWith(['/sessions', 's1'], { replaceUrl: true });
    await vi.waitFor(() => expect([vm.view(), vm.historyMode(), vm.logQuery()]).toEqual(['history', 'log', { q: 'npm test' }]));

    // Paramètre retiré, puis la vue Fichiers avec un brouillon : changer de vue demande confirmation, refusée = on reste.
    log.set(undefined);
    TestBed.tick();
    await vm.toggleFiles();
    files.set(true);
    const ask = vi.mocked(TestBed.inject(ConfirmService).ask);
    ask.mockResolvedValueOnce(false);
    log.set('autre');
    TestBed.tick();
    await vi.waitFor(() => expect(ask).toHaveBeenCalledWith(DISCARD_EDIT));
    await new Promise((r) => setTimeout(r));
    expect([vm.view(), vm.logQuery()]).toEqual(['files', { q: 'npm test' }]);
    files.set(false);
    vm.showView('workspace');
    TestBed.tick();
  });

  it('palette de recherche (?log=) sur une discussion : paramètre retiré, rien d’autre (pas d’Historique)', async () => {
    const { vm } = createVm([], undefined, undefined, undefined, aSession({ cwd: '/Users/x/.vigie/chat' }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vm.connect(signal('s1'), undefined, signal('npm'));
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    expect(navigate).toHaveBeenCalledWith(['/sessions', 's1'], { replaceUrl: true });
    expect([vm.view(), vm.logQuery()]).toEqual(['workspace', null]);
  });

  it("bascule sur l'historique, et revient au terminal pour répondre", () => {
    const { vm } = createVm();
    expect(vm.view()).toBe('workspace');
    vm.showView('history');
    expect(vm.view()).toBe('history');
    vm.allow();
    expect(vm.view()).toBe('workspace');
  });

  it('onglet Plan : présent avec un plan, retombe sur le terminal sans, tient pendant que le résumé manque', () => {
    const snapshot = signal(aSnapshot({ sessions: [aSession({ planTs: 50_000 })], terminals: [term('t1', 'claude')] }));
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(), provideVigieServiceMock({ snapshot })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect(vm.hasPlan()).toBe(true);
    vm.showView('plan');
    TestBed.tick();
    expect([vm.view(), vm.pageMode()]).toEqual(['plan', 'scroll']); // se lit d'un trait
    snapshot.set(aSnapshot({ sessions: [], terminals: [term('t1', 'claude')] })); // résumé pas (encore) là : on reste
    expect([vm.hasPlan(), vm.view()]).toEqual([null, 'plan']);
    snapshot.set(aSnapshot({ sessions: [aSession({ planTs: null })], terminals: [term('t1', 'claude')] }));
    expect([vm.hasPlan(), vm.view()]).toEqual([false, 'workspace']);
    // Dernière vue retenue « plan » (effet pas encore relancé) : une session sans plan ouvre sur le terminal.
    const next = TestBed.runInInjectionContext(() => new SessionPageVm());
    next.connect(signal('s1'));
    expect(next.view()).toBe('workspace');
    TestBed.tick(); // remet la dernière vue du module à « workspace » pour les autres tests
  });

  it('gabarit : fill pour les vues en colonnes, scroll pour celles qui se lisent d’un trait', () => {
    const { vm } = createVm();
    const modes = (['workspace', 'diff', 'files', 'history', 'config', 'usage', 'plugin:npm'] as const).map((v) => (vm.showView(v), vm.pageMode()));
    expect(modes).toEqual(['fill', 'fill', 'fill', 'fill', 'fill', 'scroll', 'fill']);
    vm.showView('workspace');
    TestBed.tick(); // remet la dernière vue du module pour les autres tests

    TestBed.resetTestingModule();
    const external = createVm().vm;
    (TestBed.inject(VigieService).snapshot as WritableSignal<Snapshot>).set(aSnapshot({ terminals: [] }));
    expect([external.isExternal(), external.pageMode()]).toEqual([true, 'scroll']); // agents seuls, sans terminal : le corps défile
  });

  it('bouton Fichiers et Ctrl+Shift+E : la vue Fichiers puis retour à la vue précédente ; rien pour une discussion', () => {
    const { vm } = createVm();
    const e = (init: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, ...init });
      vi.spyOn(ev, 'preventDefault');
      return ev;
    };
    expect(vm.canFiles()).toBe(true);
    expect(vm.filesKey).toEqual({ label: 'Ctrl+Shift+E', aria: 'Control+Shift+E' });
    vm.showView('history');
    vm.toggleFiles();
    expect(vm.view()).toBe('files');
    vm.toggleFiles();
    expect(vm.view()).toBe('history');
    const key = e();
    vm.shortcut(key);
    expect([vm.view(), vi.mocked(key.preventDefault).mock.calls.length]).toEqual(['files', 1]);
    vm.shortcut(e());
    expect(vm.view()).toBe('history');
    vm.shortcut(e({ shiftKey: false })); // Ctrl+E : pas pour nous
    vm.shortcut(e({ ctrlKey: false, metaKey: true })); // ⌘ hors mac : ignoré
    expect(vm.view()).toBe('history');
    vm.showView('workspace');
    TestBed.tick(); // remet la dernière vue du module pour les autres tests

    TestBed.resetTestingModule();
    const chat = createVm([], undefined, undefined, undefined, aSession({ cwd: '/Users/x/.vigie/chat' })).vm;
    expect(chat.canFiles()).toBe(false);
    chat.shortcut(e());
    expect(chat.view()).toBe('workspace');
  });

  it('replie et rouvre le panneau des agents', () => {
    const { vm } = createVm();
    vm.toggleAgents();
    expect(vm.agentsOpen()).toBe(false);
    vm.toggleAgents();
    expect(vm.agentsOpen()).toBe(true);
  });

  it("n'est externe que sans terminal dans Vigie", () => {
    expect(createVm().vm.isExternal()).toBe(false);
  });

  it('calcule la consommation de la session et la part de chaque agent', () => {
    const { vm } = createVm([anAgent({ tokens: 250 }), anAgent({ id: 'sub', sub: true, tokens: 750 })]);
    const u = vm.usage()!;
    expect(u.total).toBe(1000);
    expect(u.cacheRate).toBe(0.5); // 400 lus / (100 + 300 + 400) en entrée
    expect(u.parts.map((p) => p.share)).toEqual([0.4, 0.3, 0.1, 0.2]);
    expect(u.agents.map((a) => [a.id, a.width])).toEqual([['sub', 100], ['main', 33]]);
  });

  it("ouvre la sidebar d'un agent, suit ses mises à jour et la referme", () => {
    const { vm } = createVm([anAgent({}), anAgent({ id: 'sub', sub: true, name: 'explorer' })]);
    expect(vm.openAgent()).toBeNull();
    vm.showAgent('sub');
    expect(vm.openAgent()!.name).toBe('explorer');
    vm.showAgent(null);
    expect(vm.openAgent()).toBeNull();
  });

  it('reprend une session externe avec claude --resume et revient au terminal', async () => {
    const resumeSession = vi.fn(async () => term('t9', 'claude'));
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({ sessionResource: () => fakeResource({ summary: aSession(), agents: [], timeline: { start: 0, end: 0 }, usage: aSessionUsage({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0, calls: 0, context: 0 }) }), resumeSession })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    vm.showView('history');
    await vm.resume();
    expect(resumeSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', cwd: '/dev/meeplebox' }));
    expect(vm.view()).toBe('workspace');
    expect(vm.resuming()).toBe(false);
  });

  it("« Aller au terminal » ferme la sidebar et redonne le focus au terminal claude, même déjà actif", () => {
    const { vm } = createVm([anAgent({})]);
    vm.showAgent('main');
    const before = vm.focusTick();
    vm.goToTerminal();
    expect(vm.openAgent()).toBeNull();
    expect(vm.activeTab()).toBe('t1');
    expect(vm.view()).toBe('workspace');
    expect(vm.focusTick()).toBe(before + 1);
  });

  it('garde la dernière vue choisie en changeant de session, même si la page est recréée', () => {
    const { vm } = createVm();
    expect(vm.view()).toBe('workspace');
    vm.showView('config');
    TestBed.tick();
    TestBed.resetTestingModule();
    const { vm: next } = createVm();
    expect(next.view()).toBe('config');
    next.showView('workspace'); // remet la mémoire du module pour les autres tests
    TestBed.tick();
  });

  it('« Terminer » tape /exit puis Entrée après confirmation, rien sans', async () => {
    vi.useFakeTimers();
    try {
      const sendKeys = vi.fn();
      const { vm } = createVm([], sendKeys, undefined, undefined, aSession({ state: 'turn' }));
      const confirm = TestBed.inject(ConfirmService);
      vi.mocked(confirm.ask).mockResolvedValueOnce(false);
      await vm.end();
      expect(sendKeys).not.toHaveBeenCalled();
      await vm.end();
      vi.advanceTimersByTime(150);
      expect(sendKeys.mock.calls).toEqual([['t1', '/exit'], ['t1', '\r']]);
    } finally {
      vi.useRealTimers();
    }
  });
});
