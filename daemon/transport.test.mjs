// node --test daemon/*.test.mjs
// Transport sans port ni PTY : requêtes simulées passées au serveur par emit('request' | 'upgrade').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Duplex, Readable } from 'node:stream';
import { createStore } from './store.mjs';
import { createTransport } from './transport.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

const PORT = 4317;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const HOST = `127.0.0.1:${PORT}`;

const LOCALES = 'C\nPOSIX\nen_US.UTF-8\nfr_FR.UTF-8\n'; // `locale -a` simulé : les tests ne dépendent pas de la machine

function fixture({ claudeStatus, pluginsDir, settingsFile, dev } = {}) {
  const tmp = tempDir('vigie-transport-');
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
  const { server } = createTransport({ store, port: PORT, uiDir, home, chatDir, hooksFile: path.join(tmp, 'hooks.json'), claudeStatus, pluginsDir, pluginsDataDir: path.join(tmp, 'plugins-data'), settingsFile, dev, listLocales: async () => LOCALES });
  return { server, dir, store, proj, tmp };
}

/** Envoie une requête simulée ; résout { status, body } quand la réponse est terminée. */
/** `abortAfter` (ms) : la connexion se ferme avant la réponse (`close` sans `writableFinished`), comme un onglet fermé. */
function request(server, method, url, { headers = {}, body, abortAfter } = {}) {
  const req = Object.assign(Readable.from(body ? [body] : []), { method, url, headers: { host: HOST, ...headers } });
  return new Promise((resolve) => {
    const closers = [];
    const res = {
      statusCode: 0, headersSent: false, writableFinished: false, headers: {},
      writeHead(code, headers = {}) { this.statusCode = code; this.headersSent = true; this.headers = headers; },
      end(data = '') { this.writableFinished = true; resolve({ status: this.statusCode, body: String(data), headers: this.headers }); },
      on(ev, fn) { if (ev === 'close') closers.push(fn); return this; }, // res.on('close') : recherche et méthodes de plugin s'annulent
    };
    if (abortAfter !== undefined) setTimeout(() => { for (const fn of closers) fn(); }, abortAfter);
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

test('GET /api/* : Sec-Fetch-Site étranger refusé même sans Origin (<img>, fetch no-cors) ; git et git/file contrôlent l’origine ; erreurs conformes', async () => {
  const { ErrorBody } = await import('../contract/index.mjs');
  const { server } = fixture();
  for (const url of ['/api/snapshot', '/api/settings', '/api/sessions/S', '/api/sessions/S/git', '/api/sessions/S/git/file?path=a.txt', '/api/sessions/S/log', '/api/usage', '/api/search?q=ab']) {
    for (const site of ['cross-site', 'same-site']) {
      const r = await request(server, 'GET', url, { headers: { 'sec-fetch-site': site } });
      assert.equal(r.status, 403, `${url} ${site}`);
      assert.deepStrictEqual(ErrorBody.parse(JSON.parse(r.body)), { error: 'origine refusée' });
    }
    assert.equal((await request(server, 'GET', url, { headers: { origin: 'http://evil.com' } })).status, 403, url);
  }
  // UI servie par le daemon (same-origin), URL tapée (none), CLI et Electron (aucun en-tête) : acceptés.
  for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, {}]) assert.equal((await request(server, 'GET', '/api/snapshot', { headers })).status, 200, JSON.stringify(headers));
  // POST aussi : une origine acceptée ne suffit pas si le navigateur dit cross-site.
  assert.equal((await post(server, '/api/sessions/S/delete', { 'sec-fetch-site': 'cross-site' })).status, 403);
  const missing = await request(server, 'GET', '/api/sessions/inconnue');
  assert.deepStrictEqual([missing.status, ErrorBody.parse(JSON.parse(missing.body))], [404, { error: 'session inconnue' }]);
});

test('statiques : CSP de la décision 044 sur les fichiers de l’UI, pas sur l’API', async () => {
  const { server } = fixture();
  const page = await request(server, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /^default-src 'self'; script-src 'self';.*connect-src 'self' ws:\/\/127\.0\.0\.1:4317 ws:\/\/localhost:4317;.*frame-ancestors 'none'$/);
  assert.equal((await request(server, 'GET', '/api/snapshot')).headers['content-security-policy'], undefined);
});

test('POST sans paramètre (/api/chat, …/delete, …/commit-message, …/close) : seul {} passe, rien n’est lancé ni effacé', async () => {
  const { server, dir } = fixture();
  const send = (url, body) => request(server, 'POST', url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  for (const url of ['/api/chat', '/api/chat/C/delete', '/api/sessions/S/delete', '/api/sessions/S/git/commit-message', '/api/terminals/t1/close']) {
    for (const body of [{ x: 1 }, null, []]) {
      const r = await send(url, body);
      assert.deepEqual([r.status, JSON.parse(r.body)], [400, { error: 'Corps de requête invalide' }], `${url} ${JSON.stringify(body)}`);
    }
  }
  assert.ok(fs.existsSync(path.join(dir, 'C.jsonl')));
  assert.equal((await send('/api/terminals/t1/close', {})).status, 404); // {} passe, le terminal est inconnu
  assert.equal((await request(server, 'POST', '/api/terminals/t1/close', { headers: { 'content-type': 'application/json' } })).status, 404); // corps vide = {}
});

test('paramètres d’URL : since de /log et q de /api/projects passent un schéma', async () => {
  const { SessionLog } = await import('../contract/index.mjs');
  const { server } = fixture();
  const get = (url) => request(server, 'GET', url);
  for (const since of ['abc', '-1', 'Infinity']) {
    const r = await get(`/api/sessions/S/log?since=${since}`);
    assert.deepEqual([r.status, JSON.parse(r.body)], [400, { error: 'since doit être une date en ms' }], since);
  }
  for (const url of ['/api/sessions/S/log', '/api/sessions/S/log?since=0', `/api/sessions/S/log?since=${Date.now()}`]) {
    const r = await get(url);
    assert.equal(r.status, 200, url);
    assert.deepStrictEqual(SessionLog.parse(JSON.parse(r.body)), JSON.parse(r.body));
  }
  assert.equal((await get('/api/sessions/inconnue/log')).status, 404);
  const long = await get(`/api/projects?q=${'a'.repeat(5000)}`);
  assert.deepEqual([long.status, JSON.parse(long.body)], [400, { error: 'Chemin trop long' }]);
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

test('GET /plan : 200 conforme (paramètres de requête ignorés), 404 sans plan ou session inconnue', async () => {
  const { SessionPlan } = await import('../contract/index.mjs');
  const { server, dir, store, proj } = fixture();
  fs.appendFileSync(path.join(dir, 'S.jsonl'), JSON.stringify({
    type: 'assistant', timestamp: new Date(Date.now() - 30_000).toISOString(), sessionId: 'S', cwd: proj,
    message: { id: 'p', content: [{ type: 'tool_use', id: 'tp', name: 'ExitPlanMode', input: { plan: '# Plan' } }] },
  }) + '\n');
  store.scan();
  const r = await request(server, 'GET', '/api/sessions/S/plan?v=1');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepStrictEqual(SessionPlan.parse(body), body);
  assert.equal(body.text, '# Plan');
  assert.equal((await request(server, 'GET', '/api/sessions/C/plan')).status, 404);
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/plan')).status, 404);
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

test('VIGIE_DEV : trafic de ng serve passé par ui/proxy.conf.json (Host réécrit par changeOrigin, Origin localhost:4200) accepté ; refusé sans', async () => {
  // Ce que le proxy de Vite transmet : Host de la cible (changeOrigin), Origin et Sec-Fetch-Site du navigateur sur localhost:4200.
  const proxied = { host: HOST, origin: 'http://localhost:4200', 'sec-fetch-site': 'same-origin' };
  const post = (server) => request(server, 'POST', '/api/sessions/S/delete', { headers: { ...proxied, 'content-type': 'application/json' }, body: '{}' });
  /** Upgrade simulé : vrai si le daemon répond 101 (poignée de main acceptée), faux s'il coupe la connexion. */
  const upgrade = (server) => {
    const written = [];
    let destroyed = false;
    const socket = Object.assign(new Duplex({ read() {}, write(c, _e, cb) { written.push(String(c)); cb(); } }), { setTimeout() {}, setNoDelay() {} });
    socket.destroy = () => { destroyed = true; };
    server.emit('upgrade', { method: 'GET', url: '/ws', headers: { ...proxied, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } }, socket, Buffer.alloc(0));
    return !destroyed && written.join('').startsWith('HTTP/1.1 101');
  };
  const dev = fixture({ dev: true }).server;
  assert.equal((await request(dev, 'GET', '/api/snapshot', { headers: proxied })).status, 200);
  assert.equal((await post(dev)).status, 200);
  assert.equal(upgrade(dev), true);
  // Host non réécrit (proxy sans changeOrigin) : refusé, comme un DNS rebinding.
  assert.equal((await request(dev, 'GET', '/api/snapshot', { headers: { ...proxied, host: 'localhost:4200' } })).status, 403);
  const prod = fixture().server;
  assert.equal((await request(prod, 'GET', '/api/snapshot', { headers: proxied })).status, 403);
  assert.equal((await post(prod)).status, 403);
  assert.equal(upgrade(prod), false);
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
  // Restaurer réécrit le fichier aussi : même refus pendant que Claude travaille, puis permis au tour rendu.
  const restore = () => request(server, 'POST', '/api/sessions/S/git/restore', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'a.txt' }) });
  const refused = await restore();
  assert.deepEqual([refused.status, JSON.parse(refused.body)], [409, { error: 'Claude travaille dans cette session' }]);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v3\n');
  store.onHook({ session_id: 'S', hook_event_name: 'Stop' });
  assert.equal((await restore()).status, 200);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v1\n');
});

test('restauration acceptée après un Échap : l’interruption rend le tour, même juste après un PreToolUse', async () => {
  const { server, store, proj, dir } = fixture();
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: proj });
  g('init', '-q');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'v1\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'v2\n');
  const now = Date.now();
  const rec = (ms, o) => JSON.stringify({ timestamp: new Date(now - ms).toISOString(), sessionId: 'S', cwd: proj, ...o }) + '\n';
  fs.appendFileSync(path.join(dir, 'S.jsonl'),
    rec(3000, { type: 'user', message: { content: 'corrige a.txt' } }) +
    rec(2500, { type: 'assistant', message: { id: 'e1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'ed1', name: 'Edit', input: { file_path: path.join(proj, 'a.txt') } }] } }));
  store.scan();
  store.onHook({ session_id: 'S', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.txt' }, ts: now - 2400 });
  const restore = () => request(server, 'POST', '/api/sessions/S/git/restore', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'a.txt' }) });
  assert.equal((await restore()).status, 409); // Claude travaille
  // Échap : aucun hook Stop, seulement le marqueur dans le transcript.
  fs.appendFileSync(path.join(dir, 'S.jsonl'), rec(2000, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }));
  store.scan();
  const ok = await restore();
  assert.deepEqual([ok.status, JSON.parse(ok.body)], [200, { ok: true }]);
  assert.equal(fs.readFileSync(path.join(proj, 'a.txt'), 'utf8'), 'v1\n');
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
  const absent = await send({ locale: 'de_DE.UTF-8' });
  assert.equal(absent.status, 400);
  assert.match(JSON.parse(absent.body).error, /non installée/);
  assert.equal(conforme((await request(server, 'GET', '/api/settings')).body).locale, 'fr_FR.UTF-8'); // refus : rien d'écrit
  assert.equal(conforme((await send({ locale: 'fr_FR.utf8' })).body).locale, 'fr_FR.utf8'); // équivalent glibc accepté
  assert.equal(conforme((await send({ locale: null })).body).locale, null);
});

test('réglages : persistés dans settingsFile, fichier corrompu ou hors contrat ignoré', async () => {
  const tmp = tempDir('vigie-settings-');
  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json') });
  const settingsFile = path.join(tmp, 'settings.json');
  const make = () => createTransport({ store, port: PORT, uiDir: tmp, home: tmp, chatDir: tmp, hooksFile: path.join(tmp, 'hooks.json'), settingsFile, listLocales: async () => LOCALES }).server;
  const locale = async (server) => JSON.parse((await request(server, 'GET', '/api/settings')).body).locale;
  const r = await request(make(), 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: '{"locale":"fr_FR.UTF-8"}' });
  assert.equal(r.status, 200);
  assert.equal(await locale(make()), 'fr_FR.UTF-8'); // relu au redémarrage
  for (const bad of ['{', '{"locale":42}', '{"locale":"a b"}']) {
    fs.writeFileSync(settingsFile, bad);
    assert.equal(await locale(make()), null, bad);
  }  // Régression : `plugins` hors contrat ne fait plus rejeter tout le fichier ; seules ses entrées booléennes restent,
  // et le prochain POST ne perd ni la locale ni les plugins valides.
  for (const plugins of [{ mise: 'oui', xcode: true }, 'oui', ['mise'], null]) {
    fs.writeFileSync(settingsFile, JSON.stringify({ locale: 'fr_FR.UTF-8', plugins }));
    const server = make();
    assert.equal(await locale(server), 'fr_FR.UTF-8', JSON.stringify(plugins));
    assert.equal((await request(server, 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: '{"alerts":{"dailyCost":5,"windowPct":null}}' })).status, 200);
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.deepEqual([saved.locale, saved.plugins], ['fr_FR.UTF-8', plugins?.xcode ? { xcode: true } : {}], JSON.stringify(plugins));
  }
});

test('POST /api/hook : événement ajouté au spool (champs filtrés), charset toléré, hors contrat refusé', async () => {
  const tmp = tempDir('vigie-hook-');
  const spoolFile = path.join(tmp, 'spool.jsonl');
  const store = createStore({ projectsDir: path.join(tmp, 'projects'), hiddenFile: path.join(tmp, 'hidden.json') });
  const { server } = createTransport({ store, port: PORT, uiDir: tmp, home: tmp, chatDir: tmp, hooksFile: path.join(tmp, 'hooks.json'), spoolFile, listLocales: async () => LOCALES });
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

test('/api/search : conforme, q invalide 400 ErrorBody ; requête abandonnée → signal annulé, aucune réponse écrite', async () => {
  const { SessionSearch, ErrorBody } = await import('../contract/index.mjs');
  const { server, store } = fixture();
  const get = (url, opts) => request(server, 'GET', url, opts);
  const r = await get('/api/search?q=ok');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepStrictEqual(SessionSearch.parse(j), j);
  assert.ok(j.sessions.some((s) => s.id === 'S' && s.count === 1));
  for (const [url, error] of [['/api/search?q=o', 'Au moins 2 caractères'], ['/api/search', 'Indique le texte à chercher'], [`/api/search?q=${'a'.repeat(201)}`, '200 caractères au plus']]) {
    const bad = await get(url);
    assert.deepStrictEqual([bad.status, ErrorBody.parse(JSON.parse(bad.body))], [400, { error }], url);
  }
  // Abandon : le store voit son signal annulé et rend null ; le transport n'écrit rien.
  let signal;
  const seen = new Promise((resolve) => {
    store.searchSessions = async (_q, _terms, o) => {
      signal = o.signal;
      await new Promise((done) => o.signal.addEventListener('abort', done));
      resolve();
      return null;
    };
  });
  const pending = get('/api/search?q=ab', { abortAfter: 20 });
  await seen;
  const written = await Promise.race([pending.then(() => true), new Promise((done) => setTimeout(() => done(false), 50))]);
  assert.deepEqual([signal.aborted, written], [true, false]);
});

test('POST …/terminals : seul le corps vide passe ; champs d’avant les plugins (miseTask…) refusés avant tout PTY', async () => {
  const { server } = fixture();
  const send = (body, headers = {}) => request(server, 'POST', '/api/sessions/S/terminals', { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  for (const body of [{ miseTask: 'x' }, { miseTrust: true }, { script: 'hello.sh' }, null]) {
    const r = await send(body);
    assert.deepEqual([r.status, JSON.parse(r.body)], [400, { error: 'Corps de requête invalide' }], JSON.stringify(body));
  }
  assert.equal((await send({}, { origin: 'http://evil.com' })).status, 403);
  assert.equal((await request(server, 'POST', '/api/sessions/inconnue/terminals', { headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
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

// ── Plugins (décisions 034, 037) ───────────────────────────────────────────
/** Dossier de plugins temporaire avec un plugin de démo (rien dans le dépôt). */
function demoPlugins() {
  const root = tempDir('vigie-transport-plugins-');
  fs.mkdirSync(path.join(root, 'demo'));
  fs.writeFileSync(path.join(root, 'demo', 'package.json'), JSON.stringify({ name: 'demo', type: 'module', vigie: { api: 2, id: 'demo', name: 'Démo', description: 'Plugin de test' } }));
  fs.writeFileSync(path.join(root, 'demo', 'index.mjs'), `export default (v) => v.definePlugin({ id: 'demo', session: {
  detect: () => ({ badge: 1 }),
  methods: {
    double: { params: v.z.object({ n: v.z.number({ error: 'n doit être un nombre' }) }), result: v.z.object({ n: v.z.number() }), handler: ({ params }) => ({ n: params.n * 2 }) },
    rien: { handler: () => undefined },
    refuse: { handler: () => { throw v.error('Refusé par le plugin'); } },
    attend: { handler: async ({ cwd, signal }) => ({ error: (await v.exec([process.execPath, '-e', 'setTimeout(() => {}, 10000)'], { cwd, signal })).error, aborted: signal.aborted }) },
  },
  actions: {
    show: { params: v.z.object({ n: v.z.number({ error: 'n doit être un nombre' }) }), handler: ({ params }) => v.terminal(['echo', String(params.n)]) },
    term: { handler: () => v.terminal(['echo', 'ok'], { title: 'Démo' }) },
    refus: { handler: () => { throw v.error('Refusé par le plugin'); } },
  },
} });`);
  return root;
}

test('plugins : origine étrangère 403 sur les 5 routes (GET compris), 415, 413, entrées refusées, 404', async () => {
  const { server } = fixture({ pluginsDir: demoPlugins() });
  const evil = { origin: 'http://evil.com' };
  for (const url of ['/api/plugins', '/api/sessions/S/plugins']) {
    assert.equal((await request(server, 'GET', url, { headers: evil })).status, 403, url);
  }
  const posts = ['/api/plugins/demo', '/api/sessions/S/plugins/demo/actions/term', '/api/sessions/S/plugins/demo/call/double'];
  for (const url of posts) {
    assert.equal((await post(server, url, evil)).status, 403, url);
    assert.equal((await post(server, url, { 'content-type': 'text/plain' })).status, 415, url);
  }
  const send = (url, body) => request(server, 'POST', url, { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const error = async (r) => { const x = await r; return [x.status, JSON.parse(x.body).error]; };
  assert.equal((await send('/api/sessions/S/plugins/demo/call/double', { params: { s: 'x'.repeat(1e6) } })).status, 413);
  assert.deepEqual((await error(send('/api/sessions/S/plugins/demo/call/double', '{"params":')))[0], 400);
  assert.deepEqual(await error(send('/api/plugins/demo', { enabled: 'oui' })), [400, 'enabled doit être un booléen']);
  assert.deepEqual(await error(send('/api/plugins/demo', null)), [400, 'Corps de requête invalide']);
  assert.deepEqual(await error(send('/api/plugins/inconnu', { enabled: true })), [404, 'Plugin inconnu']);
  // Désactivé par défaut : ni méthode ni action.
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/call/double', { params: { n: 1 } })), [404, 'Plugin désactivé ou indisponible']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/term', {})), [404, 'Plugin désactivé ou indisponible']);
  await send('/api/plugins/demo', { enabled: true });
  // La route de vue d'avant la 037 n'existe plus.
  assert.equal((await request(server, 'GET', '/api/sessions/S/plugins/demo')).status, 404);
  // call
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/call/double', null)), [400, 'Corps de requête invalide']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/call/double', { params: { n: 'x' } })), [400, 'n doit être un nombre']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/call/refuse', {})), [400, 'Refusé par le plugin']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/call/absente', {})), [404, 'Méthode inconnue']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/call/term', {})), [404, 'Méthode inconnue']); // une action n'est pas une méthode
  assert.deepEqual(await error(send('/api/sessions/S/plugins/inconnu/call/double', {})), [404, 'Plugin désactivé ou indisponible']);
  assert.equal((await send('/api/sessions/S/plugins/demo/call/a.b', {})).status, 404);
  assert.equal((await send('/api/sessions/inconnue/plugins/demo/call/double', {})).status, 404);
  // actions
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/show', { params: 'x' })), [400, 'Paramètres invalides']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/show', { params: { 'a b': 1 } })), [400, 'Paramètres invalides']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/show', { params: { n: {} } })), [400, 'Paramètre invalide']);
  // `values` (vue déclarative, avant la 037) : refusé, plus de champ silencieusement ignoré.
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/show', { params: { n: 1 }, values: { s: 'a' } })), [400, 'Corps de requête invalide']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/show', { params: { n: 'x' } })), [400, 'n doit être un nombre']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/refus', {})), [400, 'Refusé par le plugin']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/absente', {})), [404, 'Action inconnue']);
  assert.deepEqual(await error(send('/api/sessions/S/plugins/demo/actions/double', {})), [404, 'Action inconnue']);
  assert.equal((await request(server, 'GET', '/api/sessions/inconnue/plugins')).status, 404);
  assert.equal((await send('/api/sessions/inconnue/plugins/demo/actions/show', {})).status, 404);
});

test('POST …/plugins/:pid/call : requête abandonnée → signal du handler annulé, outil tué ; réponse finie → rien d’annulé', async () => {
  const { server } = fixture({ pluginsDir: demoPlugins() });
  const send = (url, body, opts = {}) => request(server, 'POST', url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...opts });
  await send('/api/plugins/demo', { enabled: true });
  const t0 = Date.now();
  // Le handler finit quand même (outil tué) ; sa réponse, écrite sur la connexion fermée, dit ce qu'il a vu.
  const r = await send('/api/sessions/S/plugins/demo/call/attend', {}, { abortAfter: 200 });
  assert.deepEqual(JSON.parse(r.body), { error: 'annulé', aborted: true });
  assert.ok(Date.now() - t0 < 5000, 'outil non tué');
  assert.deepEqual(JSON.parse((await send('/api/sessions/S/plugins/demo/call/double', { params: { n: 2 } }, { abortAfter: 50 })).body), { n: 4 });
});

test('contrat : corps des routes de plugins (PluginCallBody, PluginActionBody)', async () => {
  const C = await import('../contract/index.mjs');
  const msg = (schema, v) => { const r = schema.safeParse(v); return r.success ? null : r.error.issues[0].message; };
  assert.equal(msg(C.PluginCallBody, {}), null);
  assert.equal(msg(C.PluginCallBody, { params: { libre: [1, { a: null }] } }), null);
  for (const v of [null, [], 'x']) assert.equal(msg(C.PluginCallBody, v), 'Corps de requête invalide', JSON.stringify(v));
  assert.equal(msg(C.PluginActionBody, { params: { a: 'x', b: 1, c: true, d: null } }), null);
  assert.notEqual(msg(C.PluginActionBody, { params: { a: 'x'.repeat(2001) } }), null);
  assert.equal(msg(C.PluginActionBody, { params: { a: [] } }), 'Paramètre invalide');
  assert.equal(msg(C.PluginActionBody, { values: {} }), 'Corps de requête invalide');
});

test('plugins : réponses conformes, snapshot.plugins, activation persistée et gardée après POST /api/settings', async () => {
  const C = await import('../contract/index.mjs');
  const conforme = (schema, body) => { const j = JSON.parse(body); assert.deepStrictEqual(schema.parse(j), j); return j; };
  const pluginsDir = demoPlugins();
  const settingsFile = path.join(tempDir('vigie-settings-'), 'settings.json');
  const { server } = fixture({ pluginsDir, settingsFile });
  const send = (url, body) => request(server, 'POST', url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.deepEqual(conforme(C.Plugins, (await request(server, 'GET', '/api/plugins')).body), [{ id: 'demo', name: 'Démo', description: 'Plugin de test', enabled: false, error: null }]);
  assert.deepEqual(conforme(C.SessionPlugins, (await request(server, 'GET', '/api/sessions/S/plugins')).body), []);
  assert.deepEqual(conforme(C.Snapshot, (await request(server, 'GET', '/api/snapshot')).body).plugins, []);

  const on = await send('/api/plugins/demo', { enabled: true });
  assert.equal(on.status, 200);
  assert.equal(conforme(C.PluginInfo, on.body).enabled, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).plugins, { demo: true });
  assert.deepEqual(conforme(C.Snapshot, (await request(server, 'GET', '/api/snapshot')).body).plugins, ['demo']);
  assert.deepEqual(conforme(C.SessionPlugins, (await request(server, 'GET', '/api/sessions/S/plugins')).body), [{ id: 'demo', name: 'Démo', badge: '1' }]);
  // call : 200 avec le JSON du plugin (pas de schéma du socle : le front valide avec celui du plugin), `null` possible.
  const doubled = await send('/api/sessions/S/plugins/demo/call/double', { params: { n: 2 } });
  assert.deepEqual([doubled.status, JSON.parse(doubled.body)], [200, { n: 4 }]);
  const nothing = await send('/api/sessions/S/plugins/demo/call/rien', {});
  assert.deepEqual([nothing.status, nothing.body], [200, 'null']);

  // Régression (P0) : un POST /api/settings ne doit pas effacer l'état des plugins du fichier.
  assert.equal((await send('/api/settings', { locale: 'fr_FR.UTF-8' })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { locale: 'fr_FR.UTF-8', plugins: { demo: true } });
  // Relu au redémarrage : le plugin reste actif, la locale aussi.
  const again = fixture({ pluginsDir, settingsFile }).server;
  assert.deepEqual(JSON.parse((await request(again, 'GET', '/api/snapshot')).body).plugins, ['demo']);
  assert.equal(JSON.parse((await request(again, 'GET', '/api/settings')).body).locale, 'fr_FR.UTF-8');
  assert.equal((await request(again, 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: '{"alerts":{"dailyCost":5,"windowPct":null}}' })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).plugins, { demo: true });
  // POST /api/settings n'accepte pas `plugins` : clé ignorée (SettingsBody), l'état ne change pas.
  await request(again, 'POST', '/api/settings', { headers: { 'content-type': 'application/json' }, body: '{"plugins":{"demo":false}}' });
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).plugins, { demo: true });

  const off = await send('/api/plugins/demo', { enabled: false });
  assert.equal(conforme(C.PluginInfo, off.body).enabled, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { locale: 'fr_FR.UTF-8', plugins: { demo: false } });
});

// Ouvre un vrai PTY (echo ok) : sauté dans le sandbox (VIGIE_NO_PTY=1).
test('plugins : action qui décrit un terminal → 201, conforme, puis fermé', { skip: process.env.VIGIE_NO_PTY === '1' && 'PTY désactivé (VIGIE_NO_PTY=1)' }, async () => {
  const C = await import('../contract/index.mjs');
  const { server, proj } = fixture({ pluginsDir: demoPlugins() });
  const send = (url, body) => request(server, 'POST', url, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await send('/api/plugins/demo', { enabled: true });
  const r = await send('/api/sessions/S/plugins/demo/actions/term', {});
  assert.equal(r.status, 201, r.body);
  const j = JSON.parse(r.body);
  assert.deepStrictEqual(C.PluginActionResult.parse(j), j);
  assert.deepEqual([j.terminal.title, j.terminal.cwd, j.terminal.kind], ['Démo', proj, 'shell']);
  assert.equal((await post(server, `/api/terminals/${j.terminal.id}/close`)).status, 200);
});
