import { TestBed } from '@angular/core/testing';
import { DOCUMENT, computed, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { Agent, SessionDetail, Terminal } from '../../core/models';
import { aMiseTasks, aSession, aSnapshot, anXcodeProject, fakeResource, provideVigieServiceMock } from '../../core/vigie.service.mock';
import { OUTDATED, VigieService } from '../../core/vigie.service';
import { Router, provideRouter } from '@angular/router';
import { provideConfirmServiceMock } from '../../core/confirm.service.mock';
import { ConfirmService } from '../../core/confirm.service';
import { SessionPageVm } from './session-page.vm';

const term = (id: string, kind: Terminal['kind']): Terminal => ({ id, sessionId: 's1', kind, title: kind, cwd: '/x', shell: 'zsh -l', pid: 1, cols: 80, rows: 24, exited: false, startedAt: 0 });
const anAgent = (extra: Partial<Agent>): Agent => ({
  id: 'main', name: 'Agent principal', sub: false, description: '', state: 'running', lastAction: null, lastText: '',
  tokens: 0, toolCount: 0, firstTs: 0, lastTs: 0, bars: [], ...extra,
});

function createVm(agents: Agent[] = [], sendKeys = vi.fn(), openShell = vi.fn(async () => term('t3', 'shell')), closeTerminal = vi.fn(async () => ({ ok: true })), summary = aSession()) {
  const detail: SessionDetail = { summary, agents, timeline: { start: 0, end: 100 }, usage: { input: 100, output: 200, cacheCreate: 300, cacheRead: 400, calls: 3, context: 800 } };
  const open = vi.fn();
  const deleteSession = vi.fn(async () => ({ ok: true }));
  TestBed.configureTestingModule({
    providers: [
      SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
      { provide: DOCUMENT, useValue: { defaultView: { open }, location: { protocol: 'http:', host: 'x' } } },
      provideVigieServiceMock({
        snapshot: signal(aSnapshot({ terminals: [term('t1', 'claude'), term('t2', 'shell')] })),
        sessionResource: (() => fakeResource(detail)) as unknown as VigieService['sessionResource'],
        sendKeys, openShell: openShell as unknown as VigieService['openShell'], deleteSession, closeTerminal,
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
          provideVigieServiceMock({ sessionResource: (() => fakeResource(undefined, 'error', error)) as unknown as VigieService['sessionResource'] })],
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
    const versions: number[] = [];
    const snapshot = signal(aSnapshot({ terminals: [term('t1', 'claude')], sessions: [aSession({ state: 'running' })] }));
    const files = [{ path: 'a.ts' }, { path: 'b.ts' }];
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({
          snapshot,
          gitResource: ((_id: () => string | null, version: () => number) => {
            const value = computed(() => (versions.push(version()), { cwd: '/x', repo: true, root: '/x', branch: null, files, total: 2 }));
            return { hasValue: () => true, value };
          }) as unknown as VigieService['gitResource'],
        })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect(vm.diffCount()).toBe(2);
    const at = (state: 'running' | 'turn', lastTs: number) => {
      snapshot.set(aSnapshot({ terminals: [term('t1', 'claude')], sessions: [aSession({ state, lastTs })] }));
      vm.diffCount();
    };
    at('running', 70_000);
    at('running', 80_000);
    expect(new Set(versions).size).toBe(1); // l'activité seule ne relance pas git
    at('turn', 90_000);
    expect(new Set(versions).size).toBe(2); // fin de tour : nouvelle version
  });

  it('tâches mise : onglet seulement si le projet en a, relues en entrant dans l’onglet, jamais à chaque événement', () => {
    const urls: (string | undefined)[] = [];
    const snapshot = signal(aSnapshot({ terminals: [term('t1', 'claude')] }));
    const tasks = signal(aMiseTasks());
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({
          snapshot,
          miseResource: ((id: () => string | null, version: () => number) => {
            const value = computed(() => (urls.push(id() ? `${id()}?v=${version()}` : undefined), tasks()));
            return { hasValue: () => true, value, isLoading: () => false, reload: vi.fn() };
          }) as unknown as VigieService['miseResource'],
        })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect([vm.hasMise(), vm.miseCount()]).toEqual([true, 1]); // la tâche globale ne compte pas
    snapshot.set(aSnapshot({ terminals: [term('t1', 'claude')], sessions: [aSession({ lastTs: 99_000 })] }));
    vm.mise();
    expect(new Set(urls)).toEqual(new Set(['s1?v=0'])); // l'activité seule ne relance pas mise
    vm.showView('mise');
    vm.mise();
    expect(urls.at(-1)).toBe('s1?v=1'); // retour sur l'onglet (après mise trust) : relue
    vm.selectTab('t1'); // un terminal ouvert depuis l'onglet ramène au terminal
    expect(vm.view()).toBe('workspace');
    tasks.set(aMiseTasks({ tasks: aMiseTasks().tasks.filter((t) => t.global) }));
    expect(vm.hasMise()).toBe(false); // globales seulement : pas d'onglet
  });

  it('Xcode : onglet seulement avec un conteneur, relu en entrant dans l’onglet, jamais retenu comme dernière vue', () => {
    const urls: (string | undefined)[] = [];
    const project = signal(anXcodeProject());
    TestBed.configureTestingModule({
      providers: [SessionPageVm, provideRouter([]), provideConfirmServiceMock(),
        provideVigieServiceMock({
          snapshot: signal(aSnapshot({ terminals: [term('t1', 'claude')] })),
          xcodeResource: ((id: () => string | null, version: () => number) => {
            const value = computed(() => (urls.push(id() ? `${id()}?v=${version()}` : undefined), project()));
            return { hasValue: () => true, value, isLoading: () => false, reload: vi.fn() };
          }) as unknown as VigieService['xcodeResource'],
        })],
    });
    const vm = TestBed.inject(SessionPageVm);
    vm.connect(signal('s1'));
    expect(vm.hasXcode()).toBe(true);
    expect(urls.at(-1)).toBe('s1?v=0');
    vm.showView('history');
    TestBed.tick();
    vm.showView('xcode');
    TestBed.tick();
    vm.xcode();
    expect(urls.at(-1)).toBe('s1?v=1');
    const next = TestBed.runInInjectionContext(() => new SessionPageVm());
    next.connect(signal('s1'));
    expect(next.view()).toBe('history'); // « xcode » n'a pas remplacé la dernière vue
    next.showView('workspace');
    TestBed.tick(); // remet la dernière vue du module pour les autres tests
    project.set(anXcodeProject({ container: null }));
    expect(vm.hasXcode()).toBe(false);
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

  it("« Voir dans le journal » : onglet Historique en mode Journal, recherche pré-remplie", () => {
    const { vm } = createVm();
    expect(vm.historyMode()).toBe('timeline');
    vm.openLog('Bash · npm test');
    expect([vm.view(), vm.historyMode(), vm.logQuery()]).toEqual(['history', 'log', 'Bash · npm test']);
  });

  it("bascule sur l'historique, et revient au terminal pour répondre", () => {
    const { vm } = createVm();
    expect(vm.view()).toBe('workspace');
    vm.showView('history');
    expect(vm.view()).toBe('history');
    vm.allow();
    expect(vm.view()).toBe('workspace');
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
        provideVigieServiceMock({ sessionResource: (() => fakeResource({ summary: aSession(), agents: [], timeline: { start: 0, end: 0 }, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, calls: 0, context: 0 } })) as unknown as VigieService['sessionResource'], resumeSession })],
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
