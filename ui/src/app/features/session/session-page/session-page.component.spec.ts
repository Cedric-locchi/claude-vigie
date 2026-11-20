import { TestBed } from '@angular/core/testing';
import { Component, input, output, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { Agent, Terminal } from '../../../core/models';
import { aSession, aSnapshot, aTerminal, anAgent, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { ConfirmService } from '../../../core/confirm.service';
import { provideConfirmServiceMock } from '../../../core/confirm.service.mock';
import { TerminalComponent } from '../../terminal/terminal/terminal.component';
import { SessionCostComponent } from '../cost/session-cost.component';
import { SessionDiffComponent } from '../diff/session-diff.component';
import { DISCARD_EDIT } from '../diff/session-diff.vm';
import { SessionFilesComponent } from '../files/session-files.component';
import { SessionPageComponent } from './session-page.component';
import { SessionPageVm } from './session-page.vm';

// xterm.js ne tourne pas dans jsdom : le terminal est remplacé par un bouchon.
@Component({ selector: 'app-terminal', template: 'terminal {{ terminalId() }}' })
class TerminalStub {
  readonly terminalId = input.required<string>();
  readonly active = input(true);
  readonly focusTick = input(0);
}

// La vue Fichiers a ses propres VM (testés à part) : bouchon ici.
@Component({ selector: 'app-session-files', template: 'fichiers' })
class SessionFilesStub {
  readonly sessionId = input.required<string>();
  readonly idle = input(false);
  readonly summary = input<unknown>(null);
  readonly openLog = output<string>();
}

// Le graphique de coût a son propre VM (testé à part) : bouchon ici.
@Component({ selector: 'app-session-cost', template: '' })
class SessionCostStub {
  readonly sessionId = input.required<string>();
  readonly state = input.required<string>();
  readonly lastTs = input.required<number>();
  readonly agents = input.required<Agent[]>();
}

const claude: Terminal = { id: 't1', sessionId: 's1', kind: 'claude', title: 'claude', cwd: '/x', shell: '/bin/zsh -l', pid: 48213, cols: 132, rows: 44, exited: false, startedAt: 0 };
const mainAgent: Agent = anAgent({ name: 'Agent principal', state: 'waiting', reason: 'permission', detail: 'Bash · xcodebuild test', tokens: 204_000, toolCount: 3, firstTs: 0, lastTs: 0 });

function render(overrides: Partial<SessionPageVm> = {}) {
  const vm = {
    connect: vi.fn(), summary: signal(aSession({ title: 'Moteur de suggestions', state: 'waiting', reason: 'permission', detail: 'Bash · xcodebuild test' })),
    stateBadge: signal({ variant: 'waiting', label: 'Attend ton autorisation' }), issues: signal(0),
    waitBar: signal<{ question: boolean; canAllow: boolean; detail: string | null } | null>({ question: false, canAllow: true, detail: 'Bash · xcodebuild test' }),
    diffCount: signal(4), hasPlan: signal<boolean | null>(false), plugins: signal<{ id: string; name: string; badge?: string }[]>([]), historyMode: signal('timeline'), showHistory: vi.fn(),
    terminals: signal([claude]), activeTab: signal('t1'), activeTerminal: signal(claude), claudeTerminal: signal(claude),
    agents: signal([mainAgent]), context: signal({ used: 150_000, max: 200_000, pct: 0.75, level: "mid" }), canCompact: signal(true), canInterrupt: signal(false), compact: vi.fn(), isChat: signal(false), visibleAgents: signal([mainAgent]), agentFilters: signal([{ state: "waiting", label: "En attente", count: 1 }]), activeAgentFilter: signal(null), filterAgents: vi.fn(), agentStats: signal({ running: 0, waiting: 1 }), logQuery: signal(''), openLog: vi.fn(), usage: signal(null), openAgent: signal(null), showAgent: vi.fn(), resuming: signal(false), diffUnsaved: signal(false), resumeError: signal(null), resume: vi.fn(), notFound: signal(false), outdated: signal(false),
    canFiles: signal(true), filesKey: { label: 'Ctrl+Shift+E', aria: 'Control+Shift+E' }, toggleFiles: vi.fn(), shortcut: vi.fn(),
    selectTab: vi.fn(), addShell: vi.fn(), closeTab: vi.fn(), detach: vi.fn(), allow: vi.fn(), refuse: vi.fn(), interrupt: vi.fn(), remove: vi.fn(), agentsOpen: signal(true), toggleAgents: vi.fn(), isExternal: signal(false), view: signal('workspace'), pageMode: signal('fill'), showView: vi.fn(), focusTick: signal(0), goToTerminal: vi.fn(), end: vi.fn(), replyError: signal<string | null>(null),
    ...overrides,
  };
  TestBed.configureTestingModule({ providers: [provideRouter([])] })
    .overrideComponent(SessionPageComponent, { set: { providers: [{ provide: SessionPageVm, useValue: vm }] } })
    .overrideComponent(SessionPageComponent, { remove: { imports: [TerminalComponent, SessionCostComponent, SessionFilesComponent] }, add: { imports: [TerminalStub, SessionCostStub, SessionFilesStub] } });
  const fixture = TestBed.createComponent(SessionPageComponent);
  fixture.componentRef.setInput('id', 's1');
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, vm, fixture };
}

describe('SessionPageComponent', () => {
  it("affiche le terminal, le badge d'état et les agents, sans barre PTY", () => {
    const { el, vm } = render();
    expect(vm.connect).toHaveBeenCalled();
    expect(el.textContent).toContain('Moteur de suggestions');
    expect(el.querySelector('header [hlmBadge]')!.textContent).toBe('Attend ton autorisation');
    expect(el.querySelector('section.agents app-agent-row')!.textContent).toContain('Bash · xcodebuild test');
    expect(el.textContent).not.toContain('pid 48213');
    expect(el.textContent).not.toContain('Hooks connectés');
  });

  it("barre d'attente sous l'en-tête, une seule fois : autoriser, refuser, aller au terminal", () => {
    const { el, vm } = render({ agentsOpen: signal(false) }); // indépendante du panneau des agents
    expect(el.querySelectorAll('app-wait-bar').length).toBe(1);
    const bar = el.querySelector('app-wait-bar')!;
    expect(bar.previousElementSibling!.tagName).toBe('HEADER');
    expect(el.querySelector('app-notification-center')).toBeNull(); // la cloche est dans le shell
    expect(bar.textContent).toContain('Claude veut lancer');
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Autoriser', 'Refuser', 'Aller au terminal']);
    buttons[0].click(); buttons[1].click(); buttons[2].click();
    expect(vm.allow).toHaveBeenCalled();
    expect(vm.refuse).toHaveBeenCalled();
    expect(vm.goToTerminal).toHaveBeenCalled();
  });

  it("barre d'attente visible sur les autres onglets, avec l'échec d'envoi", () => {
    const { el } = render({ view: signal('usage'), replyError: signal("Impossible d'envoyer la réponse au terminal : le daemon ne répond pas. Réessaie.") });
    const bar = el.querySelector('app-wait-bar')!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector('[role=alert]')!.textContent).toContain('Réessaie.');
  });

  it("barre d'attente : une question n'a pas de bouton Autoriser ; rien quand la session n'attend pas", () => {
    const { el } = render({ waitBar: signal({ question: true, canAllow: false, detail: 'Imports ou nommage ?' }) });
    expect(el.querySelector('app-wait-bar')!.textContent).toContain('Imports ou nommage ?');
    expect(el.querySelector('app-wait-bar button[variant=wait]')).toBeNull();
    TestBed.resetTestingModule();
    expect(render({ waitBar: signal(null) }).el.querySelector('app-wait-bar')).toBeNull();
  });

  it('les lignes d’agents ne portent pas les réponses : elles sont dans la barre d’attente', () => {
    const { el } = render();
    expect(el.querySelectorAll('app-agent-row button')).toHaveLength(1); // la ligne elle-même
  });

  it('un onglet par plugin qui s’applique au projet, avec son badge', () => {
    const tabs = (el: HTMLElement) => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(tabs(render().el)).toEqual(['Terminal & agents, agent en attente', 'Diff4', 'Historique', 'Consommation', 'Config']);
    TestBed.resetTestingModule();
    const el = render({ plugins: signal([{ id: 'mise', name: 'Tâches mise', badge: '3' }, { id: 'xcode', name: 'Xcode' }]) }).el;
    expect(tabs(el)).toEqual(['Terminal & agents, agent en attente', 'Diff4', 'Tâches mise3', 'Xcode', 'Historique', 'Consommation', 'Config']);
  });

  it('onglet Plan juste après le premier, seulement quand la session a un plan (discussion comprise)', () => {
    const tabs = (el: HTMLElement) => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(tabs(render().el)).not.toContain('Plan');
    TestBed.resetTestingModule();
    expect(tabs(render({ hasPlan: signal(true) }).el).slice(0, 3)).toEqual(['Terminal & agents, agent en attente', 'Plan', 'Diff4']);
    TestBed.resetTestingModule();
    expect(tabs(render({ hasPlan: signal(true), isChat: signal(true) }).el)).toEqual(['Discussion, agent en attente', 'Plan', 'Consommation']);
  });

  it('Diff affiche le nombre de fichiers modifiés, rien si 0', () => {
    expect(render().el.querySelector('[hlmTabsTrigger="diff"]')!.textContent).toContain('4');
    TestBed.resetTestingModule();
    expect(render({ diffCount: signal(0) }).el.querySelector('[hlmTabsTrigger="diff"] .count')).toBeNull();
  });

  it('nombre d’agents une seule fois : sur le bouton Agents', () => {
    const { el } = render();
    expect(el.querySelector('section.agents h2')!.textContent).toBe('Agents');
    expect(el.querySelector('.tabs .toggle')!.textContent).toContain('1');
    expect(el.querySelector('.tabs .toggle .dot')).toBeNull();
  });

  it('liste vide : invite à écrire dans le terminal', () => {
    const { el, vm } = render({ agents: signal([]), visibleAgents: signal([]), waitBar: signal(null) });
    expect(el.textContent).toContain('Écris ta première demande dans le terminal');
    [...el.querySelectorAll<HTMLButtonElement>('section.agents button')].find((b) => b.textContent!.includes('Aller au terminal'))!.click();
    expect(vm.goToTerminal).toHaveBeenCalled();
  });

  it('session externe : pas de terminal, agents en pleine largeur', () => {
    const { el } = render({ terminals: signal([]), claudeTerminal: signal(null), activeTerminal: signal(null), isExternal: signal(true), agentsOpen: signal(false) });
    expect(el.querySelector('section.term')).toBeNull();
    expect(el.querySelector('.workspace')!.classList).toContain('is-external');
    expect(el.querySelector<HTMLElement>('section.agents')!.hidden).toBe(false);
    expect(el.textContent).toContain('lancée hors de Vigie');
    expect(el.textContent).not.toContain('Interrompre');
  });

  it('ne propose de fermer que les onglets shell', () => {
    const shell: Terminal = { ...claude, id: 't2', kind: 'shell', title: 'zsh' };
    const { el, vm } = render({ terminals: signal([claude, shell]) });
    const close = el.querySelectorAll<HTMLButtonElement>('.tabs .close');
    expect(close).toHaveLength(1);
    close[0].click();
    expect(vm.closeTab).toHaveBeenCalledWith('t2');
  });

  it('bouton Fichiers dans l’en-tête : bascule la vue, qui masque les onglets et garde la barre d’attente ; absent pour une discussion', () => {
    const { el, vm } = render();
    expect([...el.querySelectorAll('[hlmTabsTrigger]')].map((b) => b.textContent!.trim())).not.toContain('Fichiers');
    const btn = () => [...el.querySelectorAll<HTMLButtonElement>('.head-actions button')].find((b) => b.textContent!.trim() === 'Fichiers');
    expect(btn()!.getAttribute('aria-pressed')).toBe('false');
    expect(btn()!.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+E');
    expect(btn()!.nextElementSibling!.textContent!.trim()).toBe('Compacter');
    btn()!.click();
    expect(vm.toggleFiles).toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true }));
    expect(vm.shortcut).toHaveBeenCalled();

    TestBed.resetTestingModule();
    const files = render({ view: signal<'workspace' | 'files'>('files'), idle: signal(true) });
    expect(files.el.querySelector<HTMLElement>('[hlmTabsList]')!.hidden).toBe(true); // barre d'onglets masquée
    expect([...files.el.querySelectorAll<HTMLButtonElement>('.head-actions button')].find((b) => b.textContent!.trim() === 'Fichiers')!.getAttribute('aria-pressed')).toBe('true');
    expect(files.el.querySelector('[hlmTabsContent="files"] app-session-files')).not.toBeNull();
    expect(files.el.querySelector('app-wait-bar')).not.toBeNull();

    TestBed.resetTestingModule();
    const chat = render({ canFiles: signal(false), isChat: signal(true) });
    expect([...chat.el.querySelectorAll('.head-actions button')].map((b) => b.textContent!.trim())).not.toContain('Fichiers');
  });

  it('onglets de vue : terminal et agents, ou historique seul', () => {
    const { el, vm } = render({ view: signal<'workspace' | 'history'>('history') });
    expect(el.querySelector<HTMLElement>('.workspace')!.hidden).toBe(true);
    expect(el.querySelector('.view app-timeline')).not.toBeNull();
    expect(el.querySelector('.view app-session-log')).toBeNull();
    [...el.querySelectorAll<HTMLButtonElement>('[hlmTabsTrigger]')].find((b) => b.textContent!.includes('Terminal'))!.click();
    expect(vm.showView).toHaveBeenCalledWith('workspace');
  });

  it('menu « Plus d’actions » : détacher le terminal, terminer la session Claude, la supprimer de Vigie', async () => {
    const { el, vm, fixture } = render();
    expect(el.querySelector('.tabs [aria-label^="Détacher"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('button[aria-label="Plus d\'actions"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const items = [...document.querySelectorAll<HTMLButtonElement>('.menu button')]; // rendu dans l'overlay
    expect(items.map((b) => b.textContent!.trim())).toEqual(['Détacher le terminal dans une fenêtre', 'Terminer la session Claude', 'Supprimer la session de Vigie']);
    items[1].click();
    expect(vm.end).toHaveBeenCalled();
    items[2].click();
    expect(vm.remove).toHaveBeenCalled();
  });

  it('replie le panneau des agents pour agrandir le terminal', () => {
    const { el, vm } = render({ agentsOpen: signal(false) });
    expect(el.querySelector('.workspace')!.classList).toContain('no-agents');
    expect(el.querySelector<HTMLElement>('section.agents')!.hidden).toBe(true);
    el.querySelector<HTMLButtonElement>('.toggle')!.click();
    expect(vm.toggleAgents).toHaveBeenCalled();
  });

  it('onglet consommation : répartition des tokens et part par agent', () => {
    const usage = { total: 1000, calls: 3, context: 800, cacheRate: 0.5, parts: [{ key: 'output', label: 'Sortie', tokens: 1000, share: 1 }], agents: [{ id: 'main', name: 'Agent principal', sub: false, tokens: 1000, cost: 1.5, width: 100 }, { id: 'a1', name: 'Explore', sub: true, tokens: 10, cost: 0.02, width: 1 }] };
    const { el } = render({ view: signal<'workspace' | 'usage'>('usage'), pageMode: signal<'fill' | 'scroll'>('scroll'), usage: signal(usage) });
    expect(el.querySelector('app-page')!.getAttribute('data-mode')).toBe('scroll'); // le corps de la page défile
    expect(el.querySelector('.lead')!.textContent).toContain('Depuis le cache'); // seul chiffre mis en avant
    expect(el.querySelector('dl')!.textContent).toContain('Contexte actuel');
    expect(el.textContent).toContain('Agent principal');
    const rows = [...el.querySelectorAll('.agent-row .row')].map((r) => r.textContent);
    expect(rows[0]).toContain('1,50'); // coût par agent
    expect(rows[1]).toContain('0,02');
    expect(el.querySelector('app-session-cost')).not.toBeNull();
  });

  it('vue terminal : la page tient dans la fenêtre (gabarit en mode fill), onglets dans la barre fixe du gabarit', () => {
    const { el } = render();
    expect(el.querySelector('app-page')!.getAttribute('data-mode')).toBe('fill');
    expect(el.querySelector('.page-tabs [hlmTabsList]')).not.toBeNull();
    expect(el.querySelector('.page-head header h1')!.textContent).toContain('Moteur de suggestions');
  });

  it("un clic sur un agent ouvre sa sidebar (sheet), Échap la ferme", async () => {
    const openAgent = signal<Agent | null>(null);
    const { el, vm, fixture } = render({ openAgent });
    el.querySelector<HTMLButtonElement>('section.agents app-agent-row button')!.click();
    expect(vm.showAgent).toHaveBeenCalledWith('main');
    openAgent.set({ ...mainAgent, lastText: 'Je lance les tests.' }); // ce que fait le VM
    fixture.detectChanges();
    await fixture.whenStable();
    // Le sheet s'affiche dans l'overlay CDK, hors du composant.
    const sheet = document.querySelector('hlm-sheet-content')!;
    expect(sheet.textContent).toContain('Je lance les tests.');
    // L'agent attend une autorisation : le focus initial va sur le titre, jamais sur « Autoriser ».
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement?.textContent?.trim()).not.toBe('Autoriser');
    expect(document.activeElement?.tagName).toBe('H2');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    expect(vm.showAgent).toHaveBeenCalledWith(null);
  });

  it('session externe : propose de la reprendre dans Vigie', () => {
    const { el, vm } = render({ terminals: signal([]), claudeTerminal: signal(null), activeTerminal: signal(null), isExternal: signal(true) });
    [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Reprendre dans Vigie'))!.click();
    expect(vm.resume).toHaveBeenCalled();
  });

  it('onglets de vue : de vrais tabpanels, aria-controls pointe dessus', () => {
    const { el } = render();
    const trigger = el.querySelector('[hlmTabsTrigger="workspace"]')!;
    const panel = el.querySelector('#' + trigger.getAttribute('aria-controls'))!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.classList).toContain('workspace');
  });

  it('barre de terminaux : groupe de boutons, le terminal actif est marqué aria-current', () => {
    const { el } = render();
    expect(el.querySelector('.tabs')!.getAttribute('role')).toBe('group');
    expect(el.querySelector('.tabs [role=tab]')).toBeNull();
    expect(el.querySelector('.tabs .tab')!.getAttribute('aria-current')).toBe('true');
  });

  it('historique en mode journal : la page tient dans la fenêtre pour que seule la liste défile', () => {
    const { el, vm } = render({ view: signal<'workspace' | 'history'>('history'), historyMode: signal('log') });
    expect(el.querySelector('app-page')!.getAttribute('data-mode')).toBe('fill');
    expect(el.querySelector('.page-body .view app-session-log')).not.toBeNull();
    [...el.querySelectorAll<HTMLButtonElement>('.history button')].find((b) => b.textContent!.includes('Chronologie'))!.click();
    expect(vm.showHistory).toHaveBeenCalledWith('timeline');
  });
});

// Câblage page ↔ vues d'édition : la page lit `unsaved` sur les composants Diff et Fichiers (viewChild), avec le vrai VM.
@Component({ selector: 'app-session-diff', template: 'diff', providers: [{ provide: SessionDiffComponent, useExisting: DiffDraftStub }] })
class DiffDraftStub {
  readonly sessionId = input.required<string>();
  readonly lastTs = input(0);
  readonly idle = input(false);
  readonly canWorktree = input(false);
  readonly worktree = output<string>();
  readonly unsaved = signal(false);
}

@Component({ selector: 'app-session-files', template: 'fichiers', providers: [{ provide: SessionFilesComponent, useExisting: FilesDraftStub }] })
class FilesDraftStub {
  readonly sessionId = input.required<string>();
  readonly idle = input(false);
  readonly summary = input<unknown>(null);
  readonly openLog = output<string>();
  readonly unsaved = signal(false);
}

describe('SessionPageComponent : brouillons des vues Diff et Fichiers', () => {
  it('un Diff modifié reste monté hors de son onglet ; quitter Fichiers modifié demande confirmation, un refus garde la vue', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideConfirmServiceMock(), provideVigieServiceMock({ snapshot: signal(aSnapshot({ terminals: [aTerminal()] })) })],
    }).overrideComponent(SessionPageComponent, {
      remove: { imports: [TerminalComponent, SessionCostComponent, SessionDiffComponent, SessionFilesComponent] },
      add: { imports: [TerminalStub, SessionCostStub, DiffDraftStub, FilesDraftStub] },
    });
    const fixture = TestBed.createComponent(SessionPageComponent);
    fixture.componentRef.setInput('id', 's1');
    fixture.detectChanges();
    const { vm } = fixture.componentInstance;
    const stub = <T>(type: new (...a: never[]) => T): T | undefined => fixture.debugElement.query(By.directive(type))?.componentInstance;
    const ask = vi.mocked(TestBed.inject(ConfirmService).ask);
    const show = async (view: 'diff' | 'history' | 'config') => {
      const ok = await vm.showView(view);
      fixture.detectChanges();
      return ok;
    };

    await show('diff');
    stub(DiffDraftStub)!.unsaved.set(true);
    fixture.detectChanges();
    await show('history');
    expect(vm.view()).toBe('history');
    expect(stub(DiffDraftStub)).toBeDefined(); // monté hors de son onglet : la saisie survit
    expect(ask).not.toHaveBeenCalled();
    stub(DiffDraftStub)!.unsaved.set(false);
    fixture.detectChanges();
    expect(stub(DiffDraftStub)).toBeUndefined();

    await vm.toggleFiles();
    fixture.detectChanges();
    stub(FilesDraftStub)!.unsaved.set(true);
    fixture.detectChanges();
    ask.mockResolvedValueOnce(false);
    expect(await show('config')).toBe(false);
    expect(ask).toHaveBeenCalledWith(DISCARD_EDIT);
    expect(vm.view()).toBe('files');
    expect(stub(FilesDraftStub)?.unsaved()).toBe(true); // même instance : le brouillon est intact
    expect(await show('config')).toBe(true); // abandon confirmé
    expect(stub(FilesDraftStub)).toBeUndefined();
    await vm.showView('workspace'); // remet la dernière vue du module
    TestBed.tick();
  });
});

