import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { LogEntry } from '../../../core/models';
import { provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionLogVm } from './session-log.vm';

const entry = (n: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: `S:${n}`, ts: 1000 * n, kind: 'assistant', title: 'Claude', text: `message ${n}`, truncated: false, agent: 'Agent principal', sub: false, ...extra,
});
const flush = () => new Promise((r) => setTimeout(r));

function createVm(pages: LogEntry[][]) {
  const sessionLog = vi.fn(async () => ({ entries: pages.shift() ?? [] }));
  TestBed.configureTestingModule({ providers: [SessionLogVm, provideVigieServiceMock({ sessionLog: sessionLog })] });
  const vm = TestBed.inject(SessionLogVm);
  const lastTs = signal(1);
  vm.connect(signal('S'), lastTs);
  return { vm, sessionLog, lastTs };
}

describe('SessionLogVm', () => {
  it('recherche imposée par la page (« Voir dans le journal »), modifiable ensuite ; redemander le même terme le réapplique', () => {
    TestBed.configureTestingModule({ providers: [SessionLogVm, provideVigieServiceMock()] });
    const vm = TestBed.inject(SessionLogVm);
    const query = signal<{ q: string } | null>({ q: 'Bash · npm test' });
    vm.connect(signal('S'), signal(1), query);
    expect(vm.query()).toBe('Bash · npm test');
    vm.setQuery('autre');
    expect(vm.query()).toBe('autre');
    query.set({ q: 'Edit · a.ts' });
    expect(vm.query()).toBe('Edit · a.ts');
    vm.setQuery('');
    query.set({ q: 'Edit · a.ts' }); // même terme, nouvelle demande
    expect(vm.query()).toBe('Edit · a.ts');
    query.set(null);
    expect(vm.query()).toBe('');
  });

  it("charge tout, puis seulement la suite à chaque activité, sans doublon", async () => {
    const { vm, sessionLog, lastTs } = createVm([[entry(1), entry(2)], [entry(2), entry(3)]]);
    TestBed.tick(); await flush();
    expect(sessionLog).toHaveBeenLastCalledWith('S', 0);
    lastTs.set(2);
    TestBed.tick(); await flush();
    expect(sessionLog).toHaveBeenLastCalledWith('S', 2000);
    expect(vm.entries().map((e) => e.id)).toEqual(['S:1', 'S:2', 'S:3']);
    // Le plus récent en haut.
    expect(vm.visible()[0].id).toBe('S:3');
  });

  it('filtre par type et par agent, avec des compteurs', async () => {
    const { vm } = createVm([[entry(1), entry(2, { kind: 'tool', title: 'Bash · npm test' }), entry(3, { kind: 'error', agent: 'explorer', sub: true })]]);
    TestBed.tick(); await flush();
    expect(vm.counts()).toMatchObject({ all: 3, talk: 1, tools: 1, errors: 1 });
    vm.setFilter('errors');
    expect(vm.visible().map((e) => e.id)).toEqual(['S:3']);
    vm.setFilter('all');
    vm.setAgent('Agent principal');
    expect(vm.visible().map((e) => e.id)).toEqual(['S:2', 'S:1']);
    expect(vm.agents()).toEqual(['Agent principal', 'explorer']);
  });

  it('recherche dans le titre et le texte, surligne et déplie les lignes trouvées', async () => {
    const long = 'début\n'.repeat(20) + 'ERREUR fatale ici';
    const { vm } = createVm([[entry(1, { text: long }), entry(2, { title: 'Bash · npm test', text: 'ok' })]]);
    TestBed.tick(); await flush();
    expect(vm.visible().find((e) => e.id === 'S:1')!.open).toBe(false);
    vm.setQuery('erreur');
    const [hit] = vm.visible();
    expect(hit.id).toBe('S:1');
    expect(hit.open).toBe(true);
    expect(hit.textParts.filter((p) => p.hit).map((p) => p.text)).toEqual(['ERREUR']);
    vm.setQuery('npm');
    expect(vm.visible()[0].titleParts).toEqual([{ text: 'Bash · ', hit: false }, { text: 'npm', hit: true }, { text: ' test', hit: false }]);
  });

  it('affiche par pages de 200', async () => {
    const { vm } = createVm([Array.from({ length: 250 }, (_, i) => entry(i + 1))]);
    TestBed.tick(); await flush();
    expect(vm.visible()).toHaveLength(200);
    expect(vm.hasMore()).toBe(true);
    vm.more();
    expect(vm.visible()).toHaveLength(250);
  });
});
