// node --test daemon/*.test.mjs
// Chargeur, SDK et runner des plugins, avec des plugins écrits dans un dossier temporaire (rien dans le dépôt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as z from 'zod/mini';
import { API, MAX_RESULT, createPlugins, createSdk, exec, killAll, readManifests, tempDir, testPlugin } from './plugins.mjs';

const tmp = () => tempDir('vigie-plugins-'); // effacé à la fin du fichier de test

/** Faux exécutable : `body` est le corps d'un script node. */
function fake(dir, name, body) {
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

/** Écrit plugins/<dir>/package.json (+ index.mjs si `code`). */
function writePlugin(root, dir, vigie, code) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify({ name: dir, type: 'module', ...(vigie ? { vigie } : {}) }));
  if (code) fs.writeFileSync(path.join(root, dir, 'index.mjs'), code);
}

test('readManifests : valide, sans vigie ignoré, id ≠ dossier et api 1 en erreur, dossier hors motif ignoré', () => {
  const root = tmp();
  writePlugin(root, 'ok', { api: API, id: 'ok', name: 'OK', description: 'Desc' });
  writePlugin(root, 'nu', null);
  writePlugin(root, 'autre', { api: API, id: 'pas-pareil', name: 'X' });
  writePlugin(root, 'futur', { api: 1, id: 'futur' }); // forme d'avant la 037 (vue déclarative)
  writePlugin(root, 'Majuscule', { api: API, id: 'Majuscule' });
  fs.mkdirSync(path.join(root, 'vide'));
  fs.writeFileSync(path.join(root, 'fichier'), ''); // nom valide mais pas un dossier
  fs.symlinkSync(path.join(root, 'absent'), path.join(root, 'lien-casse')); // stat impossible : ignoré
  const m = readManifests(root);
  assert.deepEqual(m.map((x) => [x.id, x.name, x.description, x.error === null]), [
    ['autre', 'X', '', false], ['futur', 'futur', '', false], ['ok', 'OK', 'Desc', true],
  ]);
  assert.match(m[0].error, /différent du dossier/);
  assert.match(m[1].error, /API de plugin non supportée/);
  assert.equal(m[2].entry, path.join(root, 'ok', 'index.mjs'));
  assert.deepEqual(readManifests(path.join(root, 'absent')), []);
});

test('exec : absent → missing, cwd absent, argv exact sans shell, env surchargé (null retire), stdin fermé', async () => {
  const dir = tmp();
  const opts = { baseEnv: { PATH: process.env.PATH, GARDE: 'g', RETIRE: 'r' } };
  const absent = await exec(['nulle-part'], { cwd: dir }, { ...opts, bins: { 'nulle-part': path.join(dir, 'absent') } });
  assert.deepEqual([absent.ok, absent.missing, absent.error], [false, true, 'nulle-part introuvable']);
  assert.equal((await exec(['node'], { cwd: path.join(dir, 'disparu') }, opts)).error, 'dossier introuvable');
  const echo = fake(dir, 'echo', `let i = ''; process.stdin.on('data', (d) => (i += d)).on('end', () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), env: [process.env.GARDE, process.env.RETIRE ?? null, process.env.AJOUT], input: i }));
});`);
  const r = await exec(['echo', '$(touch x)', 'a b'], { cwd: dir, env: { RETIRE: null, AJOUT: 'a' } }, { ...opts, bins: { echo } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(JSON.parse(r.stdout), { args: ['$(touch x)', 'a b'], env: ['g', null, 'a'], input: '' });
  assert.equal(fs.existsSync(path.join(dir, 'x')), false);
  const ko = await exec(['ko'], { cwd: dir }, { ...opts, bins: { ko: fake(dir, 'ko', `process.stderr.write('mal'); process.exit(3);`) } });
  assert.deepEqual([ko.ok, ko.code, ko.stderr, ko.error], [false, 3, 'mal', 'ko : code 3']);
});

test('exec : timeout tue le groupe (petit-enfant compris), signal, maxBuffer', async () => {
  const dir = tmp();
  const opts = { baseEnv: process.env };
  const pidFile = path.join(dir, 'petit-fils.pid');
  const parent = fake(dir, 'parent', `const c = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 10000);`);
  const t = await exec(['parent'], { cwd: dir, timeout: 500 }, { ...opts, bins: { parent } });
  assert.deepEqual([t.ok, t.timedOut, t.error], [false, true, 'parent ne répond pas']);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 20)); } catch (e) { assert.equal(e.code, 'ESRCH'); alive = false; }
  }
  if (alive) process.kill(pid, 'SIGKILL');
  assert.equal(alive, false, 'petit-fils encore vivant après le timeout');

  const slow = fake(dir, 'slow', 'setTimeout(() => {}, 10000);');
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const a = await exec(['slow'], { cwd: dir, signal: ac.signal }, { ...opts, bins: { slow } });
  assert.deepEqual([a.ok, a.timedOut, a.error], [false, false, 'annulé']);
  assert.equal((await exec(['slow'], { cwd: dir, signal: AbortSignal.abort() }, { ...opts, bins: { slow } })).error, 'annulé');

  // Délai borné : Infinity ne donne pas 1 ms (setTimeout) et ne tue pas l'outil tout de suite.
  const quick = fake(dir, 'quick', `setTimeout(() => process.stdout.write('fini'), 200);`);
  const inf = await exec(['quick'], { cwd: dir, timeout: Infinity }, { ...opts, bins: { quick } });
  assert.deepEqual([inf.ok, inf.timedOut, inf.stdout], [true, false, 'fini']);

  const big = fake(dir, 'big', `process.stdout.write('x'.repeat(100000)); setTimeout(() => {}, 10000);`);
  const b = await exec(['big'], { cwd: dir, maxBuffer: 1000 }, { ...opts, bins: { big } });
  assert.deepEqual([b.ok, b.error], [false, 'sortie trop volumineuse']);
});

test('killAll : tue les groupes lancés par exec encore vivants, petit-enfant compris', async () => {
  const dir = tmp();
  const pidFile = path.join(dir, 'petit-fils.pid');
  const parent = fake(dir, 'parent', `const c = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 30000);`);
  const t0 = Date.now();
  const running = exec(['parent'], { cwd: dir, timeout: 30_000 }, { bins: { parent } });
  while (!fs.existsSync(pidFile)) await new Promise((r) => setTimeout(r, 20));
  killAll();
  const r = await running;
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 10_000, 'groupe non tué par killAll');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try { process.kill(pid, 0); await new Promise((res) => setTimeout(res, 20)); } catch { alive = false; }
  }
  if (alive) process.kill(pid, 'SIGKILL');
  assert.equal(alive, false, 'petit-fils encore vivant après killAll');
  killAll(); // plus rien à tuer : sans effet
});

test('terminal : commande quotée exacte ; antislash, octet nul, option et vide refusés', async () => {
  const { terminal } = createSdk({ dataDir: tmp() });
  const plugin = (v) => v.definePlugin({ id: 'demo', session: { detect: () => true, actions: { go: { handler: () => v.terminal(['echo', "a'b", '$(x)'], { title: 'Go' }) } } } });
  const r = await testPlugin(plugin).action(tmp(), 'go');
  assert.deepEqual(r, { terminal: { argv: ['echo', "a'b", '$(x)'], title: 'Go', command: `'echo' 'a'\\''b' '$(x)'` } });
  // Le shell rend l'argv intact.
  assert.equal(execFileSync('/bin/sh', ['-c', r.terminal.command], { encoding: 'utf8' }), "a'b $(x)\n");
  for (const argv of [[], ['a\\b'], ['echo', 'x\\'], ['echo', 'a\0b'], ['-x'], [''], [42], Array(65).fill('a'), ['echo', 'x'.repeat(8001)]]) {
    assert.throws(() => terminal(argv), (e) => e.status === 400, JSON.stringify(argv).slice(0, 50));
  }
});

/** Plugin de démo configurable : méthodes et actions passées par le test. */
const demo = (session) => (v) => v.definePlugin({ id: 'demo', session: { detect: () => true, ...session(v) } });
const quiet = async (fn) => { const err = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = err; } };

test('call : params validés ou {} sans schéma, result vérifié, undefined → null, méthode inconnue 404', async () => {
  const cwd = tmp();
  const seen = [];
  const p = testPlugin(demo(() => ({
    methods: {
      typed: { params: z.object({ n: z.number({ error: 'n doit être un nombre' }) }), result: z.object({ double: z.number() }), handler: ({ params }) => { seen.push(params); return { double: params.n * 2 }; } },
      free: { handler: (ctx) => { seen.push(ctx.params); return { cwd: ctx.cwd, quand: new Date(0), trou: undefined }; } },
      rien: { handler: () => undefined },
      faux: { result: z.object({ double: z.number() }), handler: () => ({ double: 'deux' }) },
      user: { handler: () => { throw new Error('bug'); } },
    },
  })));
  assert.deepEqual(await p.call(cwd, 'typed', { n: 2 }), { double: 4 });
  await assert.rejects(p.call(cwd, 'typed', { n: 'x' }), (e) => e.status === 400 && e.message === 'n doit être un nombre');
  await assert.rejects(p.call(cwd, 'typed'), (e) => e.status === 400);
  // Sans schéma, le handler ne reçoit rien de l'UI ; la sortie est celle du JSON (Date → texte, undefined retiré).
  assert.deepEqual(await p.call(cwd, 'free', { pirate: 1 }), { cwd, quand: '1970-01-01T00:00:00.000Z' });
  assert.deepEqual(seen, [{ n: 2 }, {}]);
  assert.equal(await p.call(cwd, 'rien'), null);
  await assert.rejects(p.call(cwd, 'faux'), (e) => e.status === 500 && /^Réponse invalide du plugin demo : double : /.test(e.message));
  await quiet(() => assert.rejects(p.call(cwd, 'user'), (e) => e.status === 500 && e.message === 'Le plugin demo a échoué : bug'));
  for (const name of ['absente', 'constructor', '__proto__', 'toString']) await assert.rejects(p.call(cwd, name), (e) => e.status === 404 && e.message === 'Méthode inconnue', name);
});

test('call : non sérialisable → 500, plus de 4 Mo → 500, vigie.error → 400', async () => {
  const cwd = tmp();
  const p = testPlugin(demo((v) => ({
    methods: {
      big: { handler: () => 'x'.repeat(MAX_RESULT) }, // + 2 guillemets
      bigint: { handler: () => ({ n: 1n }) },
      cycle: { handler: () => { const o = {}; o.o = o; return o; } },
      fn: { handler: () => () => 1 },
      user: { handler: () => { throw v.error('Message pour toi'); } },
    },
  })));
  await assert.rejects(p.call(cwd, 'big'), (e) => e.status === 500 && e.message === 'Réponse trop volumineuse');
  for (const name of ['bigint', 'cycle', 'fn']) await assert.rejects(p.call(cwd, name), (e) => e.status === 500 && /non sérialisable/.test(e.message), name);
  await assert.rejects(p.call(cwd, 'user'), (e) => e.status === 400 && e.message === 'Message pour toi');
});

test('call : délai propre à la méthode, plafonné à TIMEOUTS.slow → 504 et signal annulé', async () => {
  const cwd = tmp();
  const timeouts = { detect: 50, call: 50, slow: 300 };
  let aborted = 0;
  // Répond après `ms`, ou abandonne à l'annulation.
  const after = (ms) => (ctx) => new Promise((r) => { const t = setTimeout(() => r('ok'), ms); ctx.signal.addEventListener('abort', () => { clearTimeout(t); aborted++; r('annulé'); }); });
  const p = testPlugin(demo(() => ({
    methods: {
      defaut: { handler: after(150) }, // > call (50)
      propre: { timeout: 250, handler: after(150) }, // < son délai
      plafond: { timeout: 60_000, handler: after(500) }, // > slow (300)
    },
  })), { timeouts });
  await quiet(async () => {
    await assert.rejects(p.call(cwd, 'defaut'), (e) => e.status === 504 && e.message === 'Le plugin demo ne répond pas');
    assert.equal(await p.call(cwd, 'propre'), 'ok');
    const t0 = Date.now();
    await assert.rejects(p.call(cwd, 'plafond'), (e) => e.status === 504);
    assert.ok(Date.now() - t0 < 450, 'délai non plafonné');
  });
  assert.equal(aborted, 2);
});

test('call : signal de l\'appelant (requête abandonnée) → signal du handler annulé, outil de vigie.exec tué', async () => {
  const cwd = tmp();
  const slow = fake(cwd, 'slow', 'setTimeout(() => {}, 10000);');
  const p = testPlugin(demo((v) => ({
    methods: { attend: { handler: async ({ signal }) => ({ error: (await v.exec(['slow'], { cwd, signal })).error, aborted: signal.aborted }) } },
  })), { bins: { slow } });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const t0 = Date.now();
  assert.deepEqual(await p.call(cwd, 'attend', {}, { signal: ac.signal }), { error: 'annulé', aborted: true });
  assert.ok(Date.now() - t0 < 5000, 'outil non tué');
  // Sans abandon, le signal reste intact.
  const q = testPlugin(demo(() => ({ methods: { vu: { handler: ({ signal }) => signal.aborted } } })));
  assert.equal(await q.call(cwd, 'vu', {}, { signal: new AbortController().signal }), false);
});

test('action : params validés, sans schéma → {}, sortie autre qu’un terminal → 500, action inconnue 404', async () => {
  const cwd = tmp();
  const seen = [];
  const p = testPlugin(demo((v) => ({
    actions: {
      typed: { params: z.object({ n: z.number({ error: 'n doit être un nombre' }) }), handler: ({ params }) => { seen.push(params); return v.terminal(['echo', String(params.n)]); } },
      free: { handler: ({ params }) => { seen.push(params); return v.terminal(['echo']); } },
      rien: { handler: () => undefined },
      objet: { handler: () => ({ argv: ['rm', '-rf', '/'] }) }, // un objet qui ressemble à un terminal n'en est pas un
      user: { handler: () => { throw v.error('Message pour toi'); } },
    },
  })));
  await assert.rejects(p.action(cwd, 'typed', { params: { n: 'x' } }), (e) => e.status === 400 && e.message === 'n doit être un nombre');
  assert.equal((await p.action(cwd, 'typed', { params: { n: 1 } })).terminal.command, `'echo' '1'`);
  assert.equal((await p.action(cwd, 'free', { params: { pirate: 1 } })).terminal.title, 'echo');
  assert.deepEqual(seen, [{ n: 1 }, {}]);
  for (const aid of ['rien', 'objet']) await assert.rejects(p.action(cwd, aid), (e) => e.status === 500 && /vigie.terminal/.test(e.message), aid);
  await assert.rejects(p.action(cwd, 'user'), (e) => e.status === 400 && e.message === 'Message pour toi');
  for (const aid of ['absente', 'constructor', '__proto__', 'toString']) await assert.rejects(p.action(cwd, aid), (e) => e.status === 404, aid);
});

test('runner : action lente → 504 et signal annulé ; detect lent, faux ou qui lève → absent', async () => {
  const cwd = tmp();
  let aborted = null;
  const timeouts = { detect: 50, call: 100, slow: 300 };
  const slow = (ctx) => new Promise((r) => { ctx.signal.addEventListener('abort', () => { aborted = true; r(null); }); });
  const p = testPlugin(demo(() => ({ detect: slow, actions: { wait: { handler: slow } } })), { timeouts });
  await quiet(() => assert.rejects(p.action(cwd, 'wait'), (e) => e.status === 504 && e.message === 'Le plugin demo ne répond pas'));
  assert.equal(aborted, true);
  const err = console.error;
  let logs = 0;
  console.error = () => { logs++; };
  try {
    assert.equal(await p.detect(cwd), null);
    assert.equal(logs, 1, 'detect lent : une seule ligne de journal');
    assert.equal(await testPlugin(demo(() => ({ detect: () => { throw new Error('x'); } }))).detect(cwd), null);
    assert.equal(logs, 2, 'detect qui lève : une seule ligne de journal');
  } finally { console.error = err; }
  assert.equal(await testPlugin(demo(() => ({ detect: () => false }))).detect(cwd), null);
  assert.deepEqual(await testPlugin(demo(() => ({ detect: () => ({ badge: 3 }) }))).detect(cwd), { badge: '3' });
  assert.deepEqual(await testPlugin(demo(() => ({}))).detect(cwd), {});
});

test('definePlugin : forme vérifiée au chargement', () => {
  const def = (session, opts) => testPlugin((v) => v.definePlugin({ id: 'x', session: { detect: () => true, ...session } }), opts);
  assert.throws(() => testPlugin(() => ({ id: 'x' })), /definePlugin/);
  assert.throws(() => testPlugin((v) => v.definePlugin({ id: 'x', session: {} })), /session.detect/);
  assert.throws(() => def({ actions: { a: {} } }), /sans handler/);
  assert.throws(() => def({ methods: { m: { params: z.object({}) } } }), /sans handler/);
  assert.throws(() => def({ methods: { 'a b': { handler() {} } } }), /sans handler/);
  assert.throws(() => def({ methods: [] }), /doit être un objet/);
  assert.throws(() => def({ actions: { a: { handler() {}, params: {} } } }), /schéma zod/);
  assert.throws(() => def({ methods: { m: { handler() {}, result: { type: 'object' } } } }), /result de « m » doit être un schéma zod/);
  for (const timeout of [0, 60_001, 1.5, '10', Infinity]) assert.throws(() => def({ methods: { m: { handler() {}, timeout } } }), /timeout/, String(timeout));
  assert.throws(() => def({ methods: { go: { handler() {} } }, actions: { go: { handler() {} } } }), /à la fois méthode et action/);
  // Le délai d'une action est fixe (TIMEOUTS.call) : un timeout serait ignoré, il est refusé.
  assert.throws(() => def({ actions: { a: { handler() {}, timeout: 5000 } } }), /timeout réservé aux méthodes, l'action « a »/);
  assert.throws(() => def({}, { id: 'y' }), /invalide/);
  assert.doesNotThrow(() => def({ methods: { m: { handler() {}, timeout: 60_000, result: z.null() } } }));
});

test('createPlugins : un plugin désactivé n’est jamais importé ; activation, erreurs, désactivation', async () => {
  const root = tmp();
  const marker = path.join(root, 'importé');
  writePlugin(root, 'demo', { api: API, id: 'demo', name: 'Démo', description: 'd' }, `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'oui');
export default (v) => v.definePlugin({ id: 'demo', session: {
  detect: () => ({ badge: 2 }),
  methods: { echo: { params: v.z.object({ s: v.z.string() }), handler: ({ params }) => params.s } },
  actions: { go: { handler: () => v.terminal(['echo', 'ok']) } },
} });`);
  writePlugin(root, 'casse', { api: API, id: 'casse', name: 'Cassé' }, 'export default 42;');
  writePlugin(root, 'futur', { api: 1, id: 'futur', name: 'Futur' }, 'throw new Error("jamais importé")');
  const dataRoot = path.join(root, 'data');
  const cwd = tmp();
  const plugins = createPlugins({ dir: root, dataRoot, enabled: { futur: true } });

  assert.deepEqual(plugins.active(), []);
  assert.deepEqual(await plugins.detect(cwd), []);
  await assert.rejects(plugins.call('demo', 'echo', cwd, { s: 'a' }), (e) => e.status === 404 && e.message === 'Plugin désactivé ou indisponible');
  await assert.rejects(plugins.action('demo', 'go', cwd, {}), (e) => e.status === 404);
  assert.equal(fs.existsSync(marker), false, 'plugin désactivé importé');

  const info = await plugins.setEnabled('demo', true);
  assert.deepEqual(info, { id: 'demo', name: 'Démo', description: 'd', enabled: true, error: null });
  assert.equal(fs.existsSync(marker), true);
  assert.ok(fs.statSync(path.join(dataRoot, 'demo')).isDirectory());
  assert.deepEqual(plugins.active(), ['demo']);
  assert.deepEqual(await plugins.detect(cwd), [{ id: 'demo', name: 'Démo', badge: '2' }]);
  assert.equal(await plugins.call('demo', 'echo', cwd, { s: 'a' }), 'a');
  assert.equal((await plugins.action('demo', 'go', cwd, {})).terminal.command, `'echo' 'ok'`);

  await assert.rejects(plugins.setEnabled('futur', true), (e) => e.status === 400 && /API/.test(e.message));
  await quiet(() => assert.rejects(plugins.setEnabled('casse', true), (e) => e.status === 400 && /ne se charge pas/.test(e.message)));
  await assert.rejects(plugins.setEnabled('inconnu', true), (e) => e.status === 404);
  const list = plugins.list();
  assert.deepEqual(list.map((p) => [p.id, p.enabled, p.error !== null]), [['casse', false, true], ['demo', true, false], ['futur', false, true]]);

  assert.equal((await plugins.setEnabled('demo', false)).enabled, false);
  assert.deepEqual(await plugins.detect(cwd), []);
  await assert.rejects(plugins.call('demo', 'echo', cwd, { s: 'a' }), (e) => e.status === 404);
});

test('createPlugins : un plugin activé qui ne se charge pas est importé au démarrage, absent de active(), son erreur dans list()', async () => {
  const root = tmp();
  writePlugin(root, 'casse', { api: API, id: 'casse', name: 'Cassé' }, 'throw new Error("import cassé");');
  writePlugin(root, 'demo', { api: API, id: 'demo', name: 'Démo' }, `export default (v) => v.definePlugin({ id: 'demo', session: { detect: () => true } });`);
  await quiet(async () => {
    const plugins = createPlugins({ dir: root, dataRoot: path.join(root, 'data'), enabled: { casse: true, demo: true } });
    // Même promesse mémoïsée que le chargement de fond : on attend qu'il ait échoué.
    await assert.rejects(plugins.call('casse', 'x', tmp()), (e) => e.status === 404);
    assert.deepEqual(plugins.active(), ['demo']);
    const casse = plugins.list().find((p) => p.id === 'casse');
    assert.deepEqual([casse.enabled, casse.error], [true, 'import cassé']);
    assert.deepEqual(await plugins.detect(tmp()), [{ id: 'demo', name: 'Démo' }]);
  });
});
