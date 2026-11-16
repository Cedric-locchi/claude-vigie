import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { aSession, aSnapshot, aTerminal } from './vigie.service.mock';
import { KEYS, OUTDATED, VigieService, sendReply } from './vigie.service';

class FakeSocket {
  static last: FakeSocket;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  constructor(readonly url: string) { FakeSocket.last = this; FakeSocket.all.push(this); }
  close = vi.fn();
}

describe('VigieService', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('remplace la connexion d’état silencieuse ou endormie (sortie de veille)', () => {
    vi.useFakeTimers();
    try {
      FakeSocket.all = [];
      const service = TestBed.inject(VigieService);
      const first = FakeSocket.last;
      first.readyState = 1; first.onopen?.();
      vi.advanceTimersByTime(45_000); // aucun message : connexion tenue pour morte
      expect(first.close).toHaveBeenCalled();
      expect(FakeSocket.all).toHaveLength(2);
      first.onclose?.(); // la fermeture tardive de l'ancienne ne relance rien
      vi.advanceTimersByTime(1000);
      expect(FakeSocket.all).toHaveLength(2);
      const second = FakeSocket.last;
      second.readyState = 1; second.onopen?.();
      vi.setSystemTime(Date.now() + 60_000); // veille : l'horloge saute entre deux tours
      vi.advanceTimersByTime(5000);
      expect(service.wakes()).toBe(1);
      expect(FakeSocket.all).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expose l'état poussé par le daemon", () => {
    const service = TestBed.inject(VigieService);
    expect(FakeSocket.last.url).toMatch(/\/ws$/);
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ type: 'snapshot', ...aSnapshot() }) });
    expect(service.connected()).toBe(true);
    expect(service.snapshot()?.sessions[0].id).toBe('s1');
  });

  it('envoie les touches au terminal', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const done = service.sendKeys('t1', KEYS.allow);
    const req = http.expectOne('/api/terminals/t1/input');
    expect(req.request.body).toEqual({ data: '\r' });
    req.flush({ ok: true });
    await expect(done).resolves.toEqual({ ok: true });
  });

  it('recherche : case seulement si vrai, réponse validée, annulation qui coupe la requête', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const done = service.searchFiles('s1', 'export', false);
    const req = http.expectOne((r) => r.url === '/api/sessions/s1/files/search');
    expect(req.request.params.get('q')).toBe('export');
    expect(req.request.params.has('case')).toBe(false);
    req.flush({ files: [{ path: 'a.ts', matches: [{ line: 1, col: 1, text: 'export', at: 0 }] }], truncated: false });
    await expect(done).resolves.toEqual({ files: [{ path: 'a.ts', matches: [{ line: 1, col: 1, text: 'export', at: 0 }] }], truncated: false });

    const bad = service.searchFiles('s1', 'Ex', true);
    const req2 = http.expectOne((r) => r.url === '/api/sessions/s1/files/search');
    expect(req2.request.params.get('case')).toBe('1');
    req2.flush({ files: 'non' });
    await expect(bad).rejects.toThrow(OUTDATED);

    const ctrl = new AbortController();
    const cut = service.searchFiles('s1', 'lent', false, ctrl.signal);
    const req3 = http.expectOne((r) => r.url === '/api/sessions/s1/files/search');
    ctrl.abort();
    expect(req3.cancelled).toBe(true);
    await expect(cut).rejects.toBeDefined();
  });

  it('réponse rapide : null si la touche part, sinon un message lisible (erreur du daemon ou daemon muet)', async () => {
    expect(await sendReply({ sendKeys: vi.fn(async () => ({ ok: true })) }, 't1', KEYS.allow)).toBeNull();
    expect(await sendReply({ sendKeys: vi.fn(async () => { throw { status: 404, error: { error: 'terminal inconnu' } }; }) }, 't1', KEYS.allow))
      .toBe("Impossible d'envoyer la réponse au terminal : terminal inconnu. Réessaie.");
    expect(await sendReply({ sendKeys: vi.fn(async () => { throw { status: 0, message: 'Http failure' }; }) }, 't1', KEYS.allow))
      .toBe("Impossible d'envoyer la réponse au terminal : le daemon ne répond pas. Réessaie.");
  });

  it('supprime une session', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const done = service.deleteSession('s1');
    http.expectOne({ method: 'POST', url: '/api/sessions/s1/delete' }).flush({ ok: true });
    await expect(done).resolves.toEqual({ ok: true });
  });

  it('lance une session', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const done = service.startSession({ cwd: '~/dev/x', command: 'claude' });
    http.expectOne({ method: 'POST', url: '/api/sessions' }).flush(aTerminal({ id: 't9' }));
    await expect(done).resolves.toMatchObject({ id: 't9' });
  });

  it('garde le dernier état valide et signale un snapshot hors contrat, puis retombe sur un snapshot valide', () => {
    const service = TestBed.inject(VigieService);
    const send = (data: unknown) => FakeSocket.last.onmessage?.({ data: JSON.stringify({ type: 'snapshot', ...(data as object) }) });
    send(aSnapshot());
    expect(service.incompatible()).toBe(false);

    send({ ...aSnapshot({ sessions: [aSession({ id: 's2' })] }), usage: undefined }); // daemon d'une autre version
    expect(service.incompatible()).toBe(true);
    expect(service.snapshot()?.sessions[0].id).toBe('s1');

    FakeSocket.last.onmessage?.({ data: 'pas du json' }); // trame illisible : ignorée
    expect(service.snapshot()?.sessions[0].id).toBe('s1');

    send(aSnapshot({ sessions: [aSession({ id: 's3' })] }));
    expect(service.incompatible()).toBe(false);
    expect(service.snapshot()?.sessions[0].id).toBe('s3');
  });

  it("met en erreur une ressource dont la réponse sort du contrat", async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const res = runInInjectionContext(TestBed.inject(Injector), () => service.gitResource(signal('s1'), signal(1)));
    TestBed.tick();
    http.expectOne('/api/sessions/s1/git?v=1').flush({ cwd: '/x', repo: true }); // files, total… absents
    await vi.waitFor(() => expect(res.status()).toBe('error'));
    expect(res.error()?.message).toBe(OUTDATED); // lu tel quel par les écrans (« le daemon est-il à jour ? »)
  });

  it('rejette une réponse hors contrat avec un message lisible', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const done = service.suggestCommitMessage('s1');
    http.expectOne('/api/sessions/s1/git/commit-message').flush({ text: 'feat: x' });
    await expect(done).rejects.toThrow(/est-il à jour/);
  });

  it('lit un fichier (chemin en paramètre) et rejette une réponse hors contrat', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const ok = service.gitFile('s1', 'src/a b.ts');
    http.expectOne((r) => r.url === '/api/sessions/s1/git/file' && r.params.get('path') === 'src/a b.ts').flush({ path: 'src/a b.ts', content: 'x', hash: 'h' });
    await expect(ok).resolves.toEqual({ path: 'src/a b.ts', content: 'x', hash: 'h' });
    const bad = service.gitFile('s1', 'a.ts');
    http.expectOne((r) => r.url === '/api/sessions/s1/git/file').flush({ path: 'a.ts', text: 'x' });
    await expect(bad).rejects.toThrow(OUTDATED);
  });

  it('écrit un fichier avec son empreinte', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const body = { path: 'a.ts', content: '', hash: 'a'.repeat(64) };
    const done = service.writeFile('s1', body);
    const req = http.expectOne('/api/sessions/s1/git/write');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ ok: true });
    await expect(done).resolves.toEqual({ ok: true });
  });

  it('liste les fichiers du projet, lit et écrit un fichier ; rejette un arbre hors contrat', async () => {
    const service = TestBed.inject(VigieService);
    const http = TestBed.inject(HttpTestingController);
    const tree = { root: '/x', repo: true, files: ['a.ts'], collapsed: ['node_modules'], truncated: false };
    const ok = service.files('s1');
    http.expectOne('/api/sessions/s1/files').flush(tree);
    await expect(ok).resolves.toEqual(tree);
    const bad = service.files('s1');
    http.expectOne('/api/sessions/s1/files').flush({ root: '/x', files: [] });
    await expect(bad).rejects.toThrow(OUTDATED);

    const read = service.readProjectFile('s1', '.env');
    http.expectOne((r) => r.url === '/api/sessions/s1/files/read' && r.params.get('path') === '.env').flush({ path: '.env', content: 'x', hash: 'h' });
    await expect(read).resolves.toEqual({ path: '.env', content: 'x', hash: 'h' });

    const body = { path: 'a.ts', content: '', hash: 'a'.repeat(64) };
    const done = service.writeProjectFile('s1', body);
    const req = http.expectOne('/api/sessions/s1/files/write');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ ok: true });
    await expect(done).resolves.toEqual({ ok: true });
  });
});
