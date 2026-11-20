import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { Agent, LogEntry } from '../../../../core/models';
import { anAgent, provideVigieServiceMock } from '../../../../core/vigie.service.mock';
import { AgentPanelVm, codeOf } from './agent-panel.vm';

const entry = (n: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: `a1:${n}`, ts: n * 1000, kind: 'assistant', title: 'Claude', text: `message ${n}`, truncated: false, agent: 'testeur', sub: true, ...extra,
});
const flush = () => new Promise((r) => setTimeout(r));

function setup(pages: LogEntry[][]) {
  const sessionLog = vi.fn(async () => ({ entries: pages.shift() ?? [] }));
  TestBed.configureTestingModule({ providers: [AgentPanelVm, provideVigieServiceMock({ sessionLog })] });
  const vm = TestBed.inject(AgentPanelVm);
  const agent = signal<Agent | null>(anAgent({ id: 'a1', sub: true, lastTs: 1 }));
  const sessionId = signal<string | null>('s1');
  vm.connect(agent, sessionId);
  return { vm, agent, sessionId, sessionLog };
}

describe('AgentPanelVm', () => {
  it("charge le journal, puis seulement la suite à chaque activité de l'agent ouvert ; rien sans activité nouvelle", async () => {
    const { vm, agent, sessionLog } = setup([[entry(1), entry(2)], [entry(2), entry(3)]]);
    TestBed.tick(); await flush();
    expect(sessionLog).toHaveBeenLastCalledWith('s1', 0);
    agent.set(anAgent({ id: 'a1', sub: true, lastTs: 1, tokens: 99 })); // même activité : pas de requête
    TestBed.tick(); await flush();
    expect(sessionLog).toHaveBeenCalledTimes(1);
    agent.set(anAgent({ id: 'a1', sub: true, lastTs: 2 }));
    TestBed.tick(); await flush();
    expect(sessionLog).toHaveBeenLastCalledWith('s1', 2000);
    expect(vm.feed().map((e) => e.id)).toEqual(['a1:3', 'a1:2', 'a1:1']); // sans doublon, le plus récent en haut
  });

  it('brief à part, fil sans lectures ni résultats, code des écritures', async () => {
    const { vm } = setup([[
      entry(1, { kind: 'prompt', title: 'Consigne', text: 'Ajoute **les tests**' }),
      entry(2, { kind: 'tool', title: 'Read · a.ts', text: '{"file_path":"a.ts"}' }),
      entry(3, { kind: 'tool', title: 'Edit · a.ts', text: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'const y = 2;' }) }),
      entry(4, { kind: 'result', title: 'Read', text: 'contenu lu' }),
    ]]);
    TestBed.tick(); await flush();
    expect(vm.brief()?.html).toContain('<strong>les tests</strong>');
    expect(vm.feed().map((e) => [e.title, e.code])).toEqual([['Edit · a.ts', 'const y = 2;']]);
  });

  it("dernier message en Markdown sans image distante, gardé pendant la fermeture", () => {
    const { vm, agent } = setup([]);
    agent.set(anAgent({ id: 'a1', lastText: 'Voir ![badge](https://img.shields.io/x.svg)\nfin' }));
    expect(vm.html()).not.toContain('shields');
    expect(vm.html()).toContain('badge<br>');
    agent.set(null);
    expect(vm.shown()?.id).toBe('a1');
  });

  it('journal illisible : le fil dit pourquoi (daemon injoignable, sinon le repli)', async () => {
    const sessionLog = vi.fn().mockRejectedValueOnce(new HttpErrorResponse({ status: 0 })).mockRejectedValueOnce(new Error('boom'));
    TestBed.configureTestingModule({ providers: [AgentPanelVm, provideVigieServiceMock({ sessionLog })] });
    const vm = TestBed.inject(AgentPanelVm);
    const agent = signal(anAgent({ id: 'a1' }));
    vm.connect(agent, signal('s1'));
    TestBed.tick(); await flush();
    expect(vm.logError()).toBe('Le daemon ne répond pas');
    agent.set(anAgent({ id: 'a1', lastTs: 70_000 }));
    TestBed.tick(); await flush();
    expect(vm.logError()).toBe('Fil indisponible.');
  });

  it('copie le markdown brut du dernier message', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(document.defaultView!.navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const { vm, agent } = setup([]);
      agent.set(anAgent({ id: 'a1', lastText: '**fait**' }));
      await vm.copy();
      expect(writeText).toHaveBeenCalledWith('**fait**');
      expect(vm.copied()).toBe(true);
    } finally {
      Reflect.deleteProperty(document.defaultView!.navigator, 'clipboard');
    }
  });

  it("code d'une écriture : le JSON brut s'il est coupé", () => {
    expect(codeOf(entry(1, { kind: 'tool', text: JSON.stringify({ edits: [{ new_string: 'a' }, { new_string: 'b' }] }) }))).toBe('a\n…\nb');
    expect(codeOf(entry(1, { kind: 'tool', text: '{"content": "coupé' }))).toBe('{"content": "coupé');
  });
});
