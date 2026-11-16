// node --test daemon/*.test.mjs
// Transport sans port ni PTY : requêtes simulées passées au serveur par emit('request' | 'upgrade').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createStore } from './store.mjs';
import { createTransport } from './transport.mjs';

const PORT = 4317;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const HOST = `127.0.0.1:${PORT}`;

function fixture({ miseBin, claudeStatus, xcodeBins } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-transport-'));
  const home = path.join(tmp, 'home');
  const chatDir = path.join(home, '.vigie', 'chat');
  const proj = path.join(home, 'proj');
  const uiDir = path.join(tmp, 'ui');
  for (const d of [chatDir, proj, uiDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'index.html'), '<vigie-ui>');
  const dir = path.join(tmp, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const rec = (sid, cwd) => JSON.stringify({
    type: 'assistant', timestamp: new Date(Date.now() - 60_000).toISOString(), sessionId: sid, cwd,
    message: { id: `m${sid}`, stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
  }) + '\n';
  fs.writeFileSync(path.join(dir, 'S.jsonl'), rec('S', proj));
  fs.writeFileSync(path.join(dir, 'C.jsonl'), rec('C', chatDir));
  fs.writeFileSync(path.join(dir, 'W.jsonl'), rec('W', path.join(proj, '.claude', 'worktrees', 'x')));
  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json'), chatDir, limitsDir: path.join(tmp, 'limits') });
  store.scan();
  const { server } = createTransport({ store, port: PORT, uiDir, home, chatDir, hooksFile: path.join(tmp, 'hooks.json'), miseBin, claudeStatus, xcodeBins, xcodeDir: path.join(tmp, 'xcode') });
  return { server, dir, store, proj, tmp };
}

/** Envoie une requête simulée ; résout { status, body } quand la réponse est terminée. */
function request(server, method, url, { headers = {}, body } = {}) {
  const req = Object.assign(Readable.from(body ? [body] : []), { method, url, headers: { host: HOST, ...headers } });
  return new Promise((resolve) => {
    const res = {
      statusCode: 0, headersSent: false,
      writeHead(code) { this.statusCode = code; this.headersSent = true; },
      end(data = '') { resolve({ status: this.statusCode, body: String(data) }); },
      on() { return this; }, // res.on('close') : la recherche s'annule à la fermeture
    };
    server.emit('request', req, res);
  });
}

const post = (server, url, headers = {}) => request(server, 'POST', url, { headers: { 'content-type': 'application/json', ...headers }, body: '{}' });

test('snapshot : statut de Claude joint, conforme au contrat', async () => {
  const C = await import('../contract/index.mjs');
  const { server } = fixture({ claudeStatus: () => ({ indicator: 'minor', incidents: [] }) });
  const r = await request(server, 'GET', '/api/snapshot');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.claudeStatus, { indicator: 'minor', incidents: [] });
  assert.deepStrictEqual(C.Snapshot.parse(body), body);
});

test('hôte étranger refusé, statiques compris (DNS rebinding)', async () => {
  const { server } = fixture();
  for (const url of ['/', '/api/snapshot']) {
    const r = await request(server, 'GET', url, { headers: { host: `evil.com:${PORT}` } });
    assert.equal(r.status, 403, url);
  }
});

test('POST : origine étrangère 403, corps non JSON 415', async () => {
  const { server } = fixture();
  assert.equal((await post(server, '/api/sessions/S/delete', { origin: 'http://evil.com' })).status, 403);
  assert.equal((await post(server, '/api/sessions/S/delete', { 'content-type': 'text/plain' })).status, 415);
});

test('/api/projects : récents en ~/…, sans discussion ni worktree, conformes', async () => {
  const { Projects } = await import('../contract/index.mjs');
  const { server, proj } = fixture();
  fs.writeFileSync(path.join(proj, 'Cargo.toml'), '');
  const r = await request(server, 'GET', '/api/projects');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepStrictEqual(Projects.parse(body), body);
  assert.equal(body.length, 1);
  assert.deepEqual([body[0].path, body[0].kind, body[0].branch], ['~/proj', 'rust', null]);
  assert.equal(typeof body[0].lastTs, 'number');
});

test('/api/projects?q= : sous-dossiers seulement, sans dossier caché ; chemin inexistant → [] ; origine étrangère 403', async () => {
  const { server, proj } = fixture();
  for (const d of ['ios-app', 'Infra', 'web', '.cache']) fs.mkdirSync(path.join(proj, d));
  fs.writeFileSync(path.join(proj, 'web', 'package.json'), '{}');
  const get = async (q) => JSON.parse((await request(server, 'GET', `/api/projects?q=${encodeURIComponent(q)}`)).body);
  const all = await get('~/proj/');
  assert.deepEqual(all.map((p) => p.path).sort(), ['~/proj/Infra', '~/proj/ios-app', '~/proj/web']);
  assert.deepEqual(all.find((p) => p.path === '~/proj/web'), { path: '~/proj/web', kind: 'node', branch: null, lastTs: null });
  assert.deepEqual((await get('~/proj/i')).map((p) => p.path).sort(), ['~/proj/Infra', '~/proj/ios-app']);
  assert.deepEqual(await get('~/nulle-part/x'), []);
  const r = await request(server, 'GET', '/api/projects', { headers: { origin: 'http://evil.com' } });
  assert.equal(r.status, 403);
});

test('suppression de discussion : refusée pour une session ordinaire, effective pour une discussion', async () => {
  const { server, dir } = fixture();
  const r = await post(server, '/api/chat/S/delete');
  assert.equal(r.status, 403);
  assert.ok(fs.existsSync(path.join(dir, 'S.jsonl')));
  const ok = await post(server, '/api/chat/C/delete');
  assert.equal(ok.status, 200);
  assert.equal(fs.existsSync(path.join(dir, 'C.jsonl')), false);
  assert.ok(fs.existsSync(path.join(dir, 'S.jsonl')));
});

test('config et git d’une session inconnue : 404', async () => {
  const { server } = fixture();
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/config')).status, 404);
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/git')).status, 404);
});

test('upgrade : origine étrangère ou terminal inconnu, connexion coupée', () => {
  const { server } = fixture();
  for (const [url, origin] of [['/ws', 'http://evil.com'], ['/pty/inconnu', undefined]]) {
    let destroyed = false;
    const socket = { destroy() { destroyed = true; } };
    server.emit('upgrade', { url, headers: { host: HOST, ...(origin ? { origin } : {}) } }, socket, Buffer.alloc(0));
    assert.equal(destroyed, true, url);
  }
});

test('statique : un chemin qui sort du dossier UI retombe sur index.html', async () => {
  const { server } = fixture();
  const r = await request(server, 'GET', '/..%2f..%2fetc/passwd');
  assert.equal(r.status, 200);
  assert.equal(r.body, '<vigie-ui>');
});

test('corps POST hors contrat : 400 avec le détail, rien n’est lancé', async () => {
  const { server } = fixture();
  const send = (url, body) => request(server, 'POST', url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const [url, body] of [
    ['/api/sessions', null],
    ['/api/sessions', {}],
    ['/api/sessions', { cwd: '' }],
    ['/api/sessions', { cwd: '~/proj', command: 42 }],
    ['/api/sessions/S/git/restore', {}],
    ['/api/sessions/S/git/commit', { message: '   ' }],
    ['/api/sessions/S/git/commit', null],
    ['/api/sessions/S/git/branch', { name: '--force' }],
    ['/api/sessions/S/git/branch', { name: 'a b' }],
    ['/api/sessions/S/git/write', {}],
    ['/api/sessions/S/git/write', { path: 'a.txt', content: 42, hash: 'a'.repeat(64) }],
    ['/api/sessions/S/git/write', { path: 'a.txt', content: 'x' }],
    ['/api/sessions/S/git/write', { path: 'a.txt', content: 'x', hash: 'pas-une-empreinte' }],
  ]) {
    const r = await send(url, body);
    assert.equal(r.status, 400, `${url} ${JSON.stringify(body)}`);
    assert.ok(JSON.parse(r.body).error, url);
  }
  const error = async (url, body) => JSON.parse((await send(url, body)).body).error;
  assert.equal(await error('/api/sessions', {}), 'Choisis un dossier');
  assert.equal(await error('/api/sessions', null), 'Corps de requête invalide');
  assert.equal(await error('/api/sessions', { cwd: 42 }), 'Choisis un dossier');
  assert.equal(await error('/api/sessions/S/git/commit', { message: '  ' }), 'Le message de commit est vide');
  assert.equal(await error('/api/sessions/S/git/write', { path: 'a.txt', content: 'x' }), 'Empreinte manquante');
  assert.equal(await error('/api/sessions/S/git/write', { path: 'a.txt', content: 'x', hash: 'A'.repeat(64) }), 'Empreinte invalide');
  const noPath = await request(server, 'GET', '/api/sessions/S/git/file');
  assert.deepEqual([noPath.status, JSON.parse(noPath.body)], [400, { error: 'Indique le fichier' }]);
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/git/file?path=a.txt')).status, 404);
});

test('édition d’un fichier : lecture conforme, empreinte périmée 412, écriture ; refusée pendant que Claude travaille', async () => {
  const { FileBody } = await import('../contract/index.mjs');
  const { server, store, proj } = fixture();
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: proj });
  g('init', '-q');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'v1\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'v2\n');
  const send = (body) => request(server, 'POST', '/api/sessions/S/git/write', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const r = await request(server, 'GET', '/api/sessions/S/git/file?path=a.txt');
  assert.equal(r.status, 200);
  const f = JSON.parse(r.body);
  assert.deepStrictEqual(FileBody.parse(f), f);
  assert.equal(f.content, 'v2\n');

  const stale = await send({ path: 'a.txt', content: 'v3\n', hash: '0'.repeat(64) });
  assert.equal(stale.status, 412);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v2\n');
  const ok = await send({ path: 'a.txt', content: 'v3\n', hash: f.hash });
  assert.deepEqual([ok.status, JSON.parse(ok.body)], [200, { ok: true }]);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v3\n');

  store.onHook({ session_id: 'S', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.txt' } });
  const busy = await send({ path: 'a.txt', content: 'v4\n', hash: f.hash });
  assert.deepEqual([busy.status, JSON.parse(busy.body)], [409, { error: 'Claude travaille dans cette session' }]);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v3\n');
});

test('corps illisible ou trop gros : erreur {error}, pas de promesse pendante ni de 500', async () => {
  const { server } = fixture();
  const raw = (body) => request(server, 'POST', '/api/sessions', { headers: { 'content-type': 'application/json' }, body });
  const bad = await raw('{');
  assert.deepEqual([bad.status, JSON.parse(bad.body)], [400, { error: 'JSON invalide' }]);
  const big = await raw(`{"cwd":"${'x'.repeat(1_100_000)}"}`);
  assert.deepEqual([big.status, JSON.parse(big.body)], [413, { error: 'Corps trop volumineux (1 Mo max)' }]);
});

test('message /pty : seuls input et resize entiers positifs passent', async () => {
  const { PtyMessage } = await import('../contract/index.mjs');
  assert.ok(PtyMessage.safeParse({ type: 'input', data: 'ls\r' }).success);
  assert.ok(PtyMessage.safeParse({ type: 'resize', cols: 80, rows: 24 }).success);
  for (const m of [null, {}, { type: 'input' }, { type: 'resize', cols: 0, rows: 24 }, { type: 'resize', cols: 0.5, rows: 24 }, { type: 'resize', cols: 2 ** 31, rows: 24 }, { type: 'kill' }]) {
    assert.equal(PtyMessage.safeParse(m).success, false, JSON.stringify(m));
  }
});

test('réglages : locale choisie, conforme au contrat, refusée si invalide', async () => {
  const { Settings } = await import('../contract/index.mjs');
  const { server } = fixture();
  const conforme = (body) => { const j = JSON.parse(body); assert.deepStrictEqual(Settings.parse(j), j); return j; };
  const send = (body) => request(server, 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(conforme((await request(server, 'GET', '/api/settings')).body).locale, null);
  const ok = await send({ locale: 'fr_FR.UTF-8' });
  assert.equal(ok.status, 200);
  assert.equal(conforme(ok.body).locale, 'fr_FR.UTF-8');
  const bad = await send({ locale: 'fr; rm -rf /' });
  assert.deepEqual([bad.status, JSON.parse(bad.body)], [400, { error: 'Locale invalide (ex. fr_FR.UTF-8)' }]);
  assert.equal(conforme((await send({ locale: null })).body).locale, null);
});

test('réglages : persistés dans settingsFile, fichier corrompu ou hors contrat ignoré', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-settings-'));
  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json') });
  const settingsFile = path.join(tmp, 'settings.json');
  const make = () => createTransport({ store, port: PORT, uiDir: tmp, home: tmp, chatDir: tmp, hooksFile: path.join(tmp, 'hooks.json'), settingsFile }).server;
  const locale = async (server) => JSON.parse((await request(server, 'GET', '/api/settings')).body).locale;
  const r = await request(make(), 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: '{"locale":"fr_FR.UTF-8"}' });
  assert.equal(r.status, 200);
  assert.equal(await locale(make()), 'fr_FR.UTF-8'); // relu au redémarrage
  for (const bad of ['{', '{"locale":42}', '{"locale":"a b"}']) {
    fs.writeFileSync(settingsFile, bad);
    assert.equal(await locale(make()), null, bad);
  }
});

test('POST /api/hook : événement ajouté au spool (champs filtrés), charset toléré, hors contrat refusé', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-hook-'));
  const spoolFile = path.join(tmp, 'spool.jsonl');
  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json') });
  const { server } = createTransport({ store, port: PORT, uiDir: tmp, home: tmp, chatDir: tmp, hooksFile: path.join(tmp, 'hooks.json'), spoolFile });
  const send = (body) => request(server, 'POST', '/api/hook', { headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const ok = await send({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls', other: 1 }, cwd: '/x' });
  assert.equal(ok.status, 200);
  const line = JSON.parse(fs.readFileSync(spoolFile, 'utf8').trim());
  assert.deepEqual([line.session_id, line.hook_event_name, line.tool_name, line.tool_input], ['s1', 'PreToolUse', 'Bash', { command: 'ls' }]);
  assert.equal((await send({ hook_event_name: 'Stop' })).status, 400);
  // PostToolUse d'un gros Write : au-delà de 1 Mo, accepté ; champs texte coupés à 2 000 caractères.
  const big = await send({ session_id: 's1', hook_event_name: 'PostToolUse', tool_input: { command: 'x'.repeat(5000) }, tool_response: 'y'.repeat(3_000_000) });
  assert.equal(big.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(spoolFile, 'utf8').trim().split('\n')[1]).tool_input.command.length, 2000);
  const evil = await request(server, 'POST', '/api/hook', { headers: { 'content-type': 'application/json', origin: 'https://evil.com' }, body: '{}' });
  assert.equal(evil.status, 403);
});

test('explorateur : arbre conforme, lecture d’un fichier non modifié, écriture gardée ; git/file refuse toujours un non modifié', async () => {
  const { ProjectFiles, FileBody } = await import('../contract/index.mjs');
  const { server, store, proj } = fixture();
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: proj });
  g('init', '-q');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'v1\n');
  g('add', '.'); g('commit', '-qm', 'init');
  const get = (url, headers) => request(server, 'GET', url, { headers });
  const send = (body, headers = {}) => request(server, 'POST', '/api/sessions/S/files/write', { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  const tree = await get('/api/sessions/S/files');
  assert.equal(tree.status, 200);
  const t = JSON.parse(tree.body);
  assert.deepStrictEqual(ProjectFiles.parse(t), t);
  assert.ok(t.files.includes('a.txt'));
  assert.equal((await get('/api/sessions/inconnue/files')).status, 404);
  assert.equal((await get('/api/sessions/S/files', { origin: 'http://evil.com' })).status, 403);
  assert.equal((await get('/api/sessions/S/files/read?path=a.txt', { origin: 'http://evil.com' })).status, 403);
  const noPath = await get('/api/sessions/S/files/read');
  assert.deepEqual([noPath.status, JSON.parse(noPath.body)], [400, { error: 'Indique le fichier' }]);
  assert.equal((await get('/api/sessions/inconnue/files/read?path=a.txt')).status, 404);
  assert.equal((await get('/api/sessions/S/files/read?path=.git/config')).status, 400);
  assert.equal((await get('/api/sessions/S/git/file?path=a.txt')).status, 400); // non modifié : l'onglet Diff ne change pas

  const r = await get('/api/sessions/S/files/read?path=a.txt');
  const f = JSON.parse(r.body);
  assert.deepStrictEqual(FileBody.parse(f), f);
  assert.equal(f.content, 'v1\n');

  assert.equal((await send({ path: 'a.txt', content: 'x', hash: f.hash }, { origin: 'http://evil.com' })).status, 403);
  assert.equal((await send({ path: 'a.txt', content: 'x', hash: f.hash }, { 'content-type': 'text/plain' })).status, 415);
  for (const body of [{}, { path: 'a.txt', content: 'x' }, { path: 'a.txt', content: 42, hash: f.hash }, { path: 'a.txt', content: 'x', hash: 'court' }]) {
    assert.equal((await send(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await send({ path: 'a.txt', content: 'v2\n', hash: '0'.repeat(64) })).status, 412);
  const ok = await send({ path: 'a.txt', content: 'v2\n', hash: f.hash });
  assert.deepEqual([ok.status, JSON.parse(ok.body)], [200, { ok: true }]);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v2\n');

  store.onHook({ session_id: 'S', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.txt' } });
  const busy = await send({ path: 'a.txt', content: 'v3\n', hash: sha256('v2\n') });
  assert.deepEqual([busy.status, JSON.parse(busy.body)], [409, { error: 'Claude travaille dans cette session' }]);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v2\n');
});

test('recherche dans l’explorateur : conforme, origine, session inconnue, q invalide, casse', async () => {
  const { SearchResults } = await import('../contract/index.mjs');
  const { server, proj } = fixture();
  fs.writeFileSync(path.join(proj, 'a.txt'), 'Aiguille\n');
  const get = (url, headers) => request(server, 'GET', url, { headers });
  const r = await get('/api/sessions/S/files/search?q=aiguille');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepStrictEqual(SearchResults.parse(j), j);
  assert.deepEqual(j.files.map((f) => f.path), ['a.txt']);
  assert.deepEqual(JSON.parse((await get('/api/sessions/S/files/search?q=aiguille&case=1')).body).files, []);
  assert.equal(JSON.parse((await get('/api/sessions/S/files/search?q=Aiguille&case=1')).body).files.length, 1);
  assert.equal((await get('/api/sessions/S/files/search?q=aiguille', { origin: 'http://evil.com' })).status, 403);
  assert.equal((await get('/api/sessions/inconnue/files/search?q=aiguille')).status, 404);
  const none = await get('/api/sessions/S/files/search');
  assert.deepEqual([none.status, JSON.parse(none.body)], [400, { error: 'Indique le texte à chercher' }]);
  const one = await get('/api/sessions/S/files/search?q=a');
  assert.deepEqual([one.status, JSON.parse(one.body)], [400, { error: 'Au moins 2 caractères' }]);
});

test('/mise : origine étrangère 403, session inconnue 404, réponse conforme ; env sans MISE_YES, hors ligne', async () => {
  const { MiseTasks } = await import('../contract/index.mjs');
  const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-fake-mise-')), 'mise');
  // Faux mise : une tâche dont la description rapporte l'environnement reçu.
  fs.writeFileSync(bin, `#!/usr/bin/env node
process.stdout.write(JSON.stringify([{ name: 'test', aliases: ['t'], description: JSON.stringify([process.env.MISE_YES ?? null, process.env.MISE_OFFLINE, process.env.MISE_HIDE_UPDATE_WARNING]), source: process.cwd() + '/mise.toml', env: ['SECRET=x'] }]));
`);
  fs.chmodSync(bin, 0o755);
  process.env.MISE_YES = '1';
  let server;
  try { ({ server } = fixture({ miseBin: bin })); } finally { delete process.env.MISE_YES; }
  assert.equal((await request(server, 'GET', '/api/sessions/S/mise', { headers: { origin: 'http://evil.com' } })).status, 403);
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/mise')).status, 404);
  const r = await request(server, 'GET', '/api/sessions/S/mise');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepStrictEqual(MiseTasks.parse(j), j);
  assert.deepEqual(JSON.parse(j.tasks[0].description), [null, '1', '1']);
  assert.equal(j.tasks[0].source, 'mise.toml');
  assert.equal('env' in j.tasks[0], false);

  const absent = JSON.parse((await request(fixture({ miseBin: path.join(path.dirname(bin), 'absent') }).server, 'GET', '/api/sessions/S/mise')).body);
  assert.deepEqual(absent, { available: false, untrusted: false, tasks: [], error: null });

  // Lancement : nom absent de la liste, ou tâche et trust ensemble, refusés avant tout PTY.
  const send = (body) => request(server, 'POST', '/api/sessions/S/terminals', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const [body, error] of [
    [{ miseTask: 'inconnue' }, 'Tâche mise inconnue'],
    [{ miseTask: "test'; rm -rf ~" }, 'Tâche mise inconnue'],
    [{ miseTask: 'test', miseTrust: true }, 'Une seule action à la fois'],
    [{ miseTask: 42 }, 'La tâche mise doit être un texte'],
    [{ miseTrust: 'oui' }, 'miseTrust doit être un booléen'],
    [null, 'Corps de requête invalide'],
  ]) {
    const res = await send(body);
    assert.deepEqual([res.status, JSON.parse(res.body)], [400, { error }], JSON.stringify(body));
  }
  assert.equal((await request(server, 'POST', '/api/sessions/S/terminals', { headers: { 'content-type': 'application/json', origin: 'http://evil.com' }, body: '{"miseTrust":true}' })).status, 403);
});

test('/api/usage?days= : borné à 1..400, conforme ; /cost : conforme, 404 si inconnue', async () => {
  const C = await import('../contract/index.mjs');
  const { server } = fixture();
  for (const days of ['0', '401', 'abc', '1.5', '']) {
    const r = await request(server, 'GET', `/api/usage?days=${days}`);
    assert.equal(r.status, 400, days);
    assert.match(JSON.parse(r.body).error, /jours/);
  }
  for (const url of ['/api/usage', '/api/usage?days=90']) {
    const r = await request(server, 'GET', url);
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.deepStrictEqual(C.UsageRows.parse(j), j);
  }
  const since = (days) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1)).getTime(); };
  assert.equal(JSON.parse((await request(server, 'GET', '/api/usage?days=90')).body).since, since(90));
  assert.equal(JSON.parse((await request(server, 'GET', '/api/usage')).body).since, since(14));
  const cost = await request(server, 'GET', '/api/sessions/S/cost');
  assert.equal(cost.status, 200);
  const j = JSON.parse(cost.body);
  assert.deepStrictEqual(C.SessionCost.parse(j), j);
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/cost')).status, 404);
});

test('réglages : seuils d’alerte enregistrés sans toucher la locale (et inversement), hors bornes refusés', async () => {
  const { Settings } = await import('../contract/index.mjs');
  const { server } = fixture();
  const send = async (body) => {
    const r = await request(server, 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = JSON.parse(r.body);
    if (r.status === 200) assert.deepStrictEqual(Settings.parse(j), j);
    return { status: r.status, j };
  };
  assert.deepEqual(JSON.parse((await request(server, 'GET', '/api/settings')).body).alerts, { dailyCost: null, windowPct: null });
  await send({ locale: 'fr_FR.UTF-8' });
  const a = await send({ alerts: { dailyCost: 50, windowPct: 0.8 } });
  assert.deepEqual([a.status, a.j.locale, a.j.alerts], [200, 'fr_FR.UTF-8', { dailyCost: 50, windowPct: 0.8 }]);
  const l = await send({ locale: null });
  assert.deepEqual([l.j.locale, l.j.alerts], [null, { dailyCost: 50, windowPct: 0.8 }]);
  const bad = await send({ alerts: { dailyCost: null, windowPct: 2 } });
  assert.deepEqual([bad.status, bad.j], [400, { error: 'Entre 1 et 100 %' }]);
  for (const alerts of [{ dailyCost: -1, windowPct: null }, { dailyCost: 1e6, windowPct: null }, { dailyCost: '5', windowPct: null }, { windowPct: 0.5 }, { dailyCost: null, windowPct: 0 }]) {
    assert.equal((await send({ alerts })).status, 400, JSON.stringify(alerts));
  }
  assert.deepEqual((await send({ alerts: { dailyCost: null, windowPct: null } })).j.alerts, { dailyCost: null, windowPct: null });
});

test('/xcode : 403, 404, conforme ; targets sans conteneur ou sans Xcode → indisponible', async () => {
  const C = await import('../contract/index.mjs');
  const absent = path.join(os.tmpdir(), 'vigie-pas-de-xcode');
  const { server, proj } = fixture({ xcodeBins: { xcodebuild: absent, xcrun: absent, xed: absent } });
  const get = async (url, headers) => { const r = await request(server, 'GET', url, { headers }); return { status: r.status, j: JSON.parse(r.body) }; };
  for (const url of ['/api/sessions/S/xcode', '/api/sessions/S/xcode/targets']) {
    assert.equal((await get(url, { origin: 'http://evil.com' })).status, 403, url);
    assert.equal((await get(url.replace('/S/', '/inconnue/'))).status, 404, url);
  }
  assert.deepEqual((await get('/api/sessions/S/xcode')).j, { container: null, scripts: [] });
  const none = (await get('/api/sessions/S/xcode/targets')).j;
  assert.deepEqual(none, { available: false, schemes: [], simulators: [], error: 'Pas un projet Xcode' });
  assert.deepStrictEqual(C.XcodeTargets.parse(none), none);

  fs.mkdirSync(path.join(proj, 'App.xcworkspace'));
  fs.mkdirSync(path.join(proj, 'scripts'));
  fs.writeFileSync(path.join(proj, 'scripts', 'seed.sh'), 'echo ok\n');
  const p = await get('/api/sessions/S/xcode');
  assert.deepEqual(p.j, { container: { kind: 'workspace', name: 'App.xcworkspace' }, scripts: ['seed.sh'] });
  assert.deepStrictEqual(C.XcodeProject.parse(p.j), p.j);
  const t = (await get('/api/sessions/S/xcode/targets')).j;
  assert.deepEqual(t, { available: false, schemes: [], simulators: [], error: null });
  assert.deepStrictEqual(C.XcodeTargets.parse(t), t);
});

test('POST …/terminals xcode et script : refus avant tout PTY', async () => {
  const { server, proj } = fixture();
  const U = '0A1B2C3D-0000-1111-2222-333344445555';
  const send = (body, headers = {}) => request(server, 'POST', '/api/sessions/S/terminals', { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const refuse = async (body, error) => {
    const r = await send(body);
    assert.deepEqual([r.status, JSON.parse(r.body)], [400, { error }], JSON.stringify(body));
  };
  // Dossier non iOS : un corps valide est refusé (jamais de 201 xcode dans les tests : il lancerait le vrai xcodebuild).
  await refuse({ xcode: { action: 'build', scheme: 'App', udid: U } }, 'Pas un projet Xcode');
  fs.mkdirSync(path.join(proj, 'App.xcodeproj'));
  fs.mkdirSync(path.join(proj, 'scripts'));
  fs.writeFileSync(path.join(proj, 'scripts', 'hello.sh'), 'echo bonjour\n');
  await refuse({ xcode: { action: 'build', scheme: 'App', udid: 'pas-un-udid' } }, 'Simulateur invalide');
  await refuse({ xcode: { action: 'build', scheme: '-x', udid: U } }, 'Scheme invalide');
  // fish : `\'` sort des guillemets simples de shQuote.
  await refuse({ xcode: { action: 'build', scheme: "a\\'b", udid: U } }, 'Scheme invalide');
  await refuse({ xcode: { action: 'build', scheme: "a'b", udid: U } }, 'Scheme invalide');
  await refuse({ xcode: { action: 'build', scheme: 'App' } }, 'Choisis un simulateur');
  await refuse({ xcode: { action: 'run', scheme: 'App', udid: U }, script: 'hello.sh' }, 'Une seule action à la fois');
  await refuse({ miseTrust: true, script: 'hello.sh' }, 'Une seule action à la fois');
  await refuse({ script: '../x.sh' }, 'Script invalide');
  await refuse({ script: 'absent.sh' }, 'Script inconnu');
  assert.equal((await send({ script: 'hello.sh' }, { origin: 'http://evil.com' })).status, 403);
});

// Seul test qui ouvre un vrai PTY (script inoffensif). Pas de sonde : une panne de node-pty (spawn-helper sans +x) doit faire échouer.
// Le sandbox macOS refuse posix_spawnp : y lancer les tests avec VIGIE_NO_PTY=1.
test('POST …/terminals script listé : 201, puis fermé', { skip: process.env.VIGIE_NO_PTY === '1' && 'PTY désactivé (VIGIE_NO_PTY=1)' }, async () => {
  const { server, proj } = fixture();
  fs.mkdirSync(path.join(proj, 'scripts'));
  fs.writeFileSync(path.join(proj, 'scripts', 'hello.sh'), 'echo bonjour\n');
  const ok = await request(server, 'POST', '/api/sessions/S/terminals', { headers: { 'content-type': 'application/json' }, body: '{"script":"hello.sh"}' });
  assert.equal(ok.status, 201, ok.body);
  const term = JSON.parse(ok.body);
  assert.deepEqual([term.title, term.cwd, term.kind], ['hello.sh', proj, 'shell']);
  assert.equal((await post(server, `/api/terminals/${term.id}/close`)).status, 200);
});

test('POST …/xcode/open : origine 403, session inconnue 404, pas iOS 400, xed lancé sinon', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-fake-xed-'));
  const out = path.join(dir, 'argv.json');
  const xed = path.join(dir, 'xed');
  fs.writeFileSync(xed, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
  fs.chmodSync(xed, 0o755);
  const { server, proj } = fixture({ xcodeBins: { xcodebuild: 'xcodebuild', xcrun: 'xcrun', xed } });
  assert.equal((await post(server, '/api/sessions/S/xcode/open', { origin: 'http://evil.com' })).status, 403);
  assert.equal((await post(server, '/api/sessions/inconnue/xcode/open')).status, 404);
  const no = await post(server, '/api/sessions/S/xcode/open');
  assert.deepEqual([no.status, JSON.parse(no.body)], [400, { error: 'Pas un projet Xcode' }]);
  fs.writeFileSync(path.join(proj, 'Package.swift'), '');
  const r = await post(server, '/api/sessions/S/xcode/open');
  assert.deepEqual([r.status, JSON.parse(r.body)], [200, { ok: true }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [proj]);
});
