// node --test plugins/*/*.test.mjs
// Sans Nx : faux nx (script node) écrit dans node_modules/.bin du dossier, ou passé par `bins` pour le nx du PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir, testPlugin } from '../../daemon/plugins.mjs';
import { NxGraph, NxRunParams } from './contract.mjs';
import plugin, { ENV, LOCAL_NX, TELEMETRY, dataDirFor, parseNxGraph, runArgv } from './index.mjs';

const tmp = () => tempDir('vigie-nx-'); // effacé à la fin du fichier de test

/** Faux exécutable : `body` est le corps d'un script node. */
function fake(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}
/** Espace Nx : nx.json (texte) et, si `local`, un faux node_modules/.bin/nx. */
function workspace(nxJson = '{}', local) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'nx.json'), nxJson);
  if (local) fake(path.join(dir, LOCAL_NX), local);
  return dir;
}

const GRAPH = { graph: { nodes: {
  web: { name: 'web', type: 'app', data: { root: 'apps/web', targets: {
    build: { executor: '@nx/vite:build', metadata: { description: 'Construit' } },
    serve: { executor: 'nx:run-commands', options: { command: 'vite' } },
    'build:prod': { executor: 'nx:run-commands', options: { commands: ['a', { command: 'b' }, 3] } },
    test: { executor: 'nx:run-script', metadata: { scriptContent: 'vitest run' } },
  } } },
  '-bad': { name: '-bad', type: 'lib', data: { root: 'libs/bad', targets: { lint: {} } } },
  core: { type: 'lib', data: { projectType: 'library', root: 'libs/core' } },
}, dependencies: {} } };

test('parseNxGraph : avertissements avant le JSON, commandes, descriptions, tri, cibles lançables', () => {
  const { projects, truncated } = parseNxGraph(`NX  avertissement {pas du json}\n${JSON.stringify(GRAPH)}`);
  assert.equal(truncated, false);
  assert.deepEqual(projects.map((p) => [p.name, p.type, p.root]), [['-bad', 'lib', 'libs/bad'], ['core', 'lib', 'libs/core'], ['web', 'app', 'apps/web']]);
  assert.deepEqual(projects[2].targets, [
    { name: 'build', command: '@nx/vite:build', description: 'Construit', runnable: true },
    { name: 'build:prod', command: 'a && b', description: '', runnable: false },
    { name: 'serve', command: 'vite', description: '', runnable: true },
    { name: 'test', command: 'vitest run', description: '', runnable: true },
  ]);
  assert.deepEqual(projects[0].targets, [{ name: 'lint', command: '', description: '', runnable: false }]);
  assert.deepEqual(projects[1].targets, []);
  assert.throws(() => parseNxGraph('rien'));
  assert.throws(() => parseNxGraph('{"graph":'));
  assert.throws(() => parseNxGraph('{"graph":{}}'));
});

test('parseNxGraph : budget en octets (JSON des projets), projets entiers, `truncated`', () => {
  // Description non ASCII : « é » compte 2 octets, pas 1 caractère.
  const node = (name) => ({ name, data: { targets: { t: { metadata: { description: 'é'.repeat(100) } } } } });
  const one = Buffer.byteLength(JSON.stringify(parseNxGraph(JSON.stringify({ graph: { nodes: { a: node('a') } } })).projects[0])) + 1;
  assert.ok(one > 200, 'octets, pas caractères');
  const graph = JSON.stringify({ graph: { nodes: { c: node('c'), a: node('a'), b: node('b') } } });
  assert.deepEqual(Object.values(parseNxGraph(graph, 3 * one)).map((x) => (Array.isArray(x) ? x.map((p) => p.name) : x)), [['a', 'b', 'c'], false]);
  assert.deepEqual(Object.values(parseNxGraph(graph, 3 * one - 1)).map((x) => (Array.isArray(x) ? x.map((p) => p.name) : x)), [['a', 'b'], true]);
  assert.deepEqual(parseNxGraph(graph, 10), { projects: [], truncated: true });
});

test('fonctions pures : env de lecture, cache par dossier, argv local ou PATH', () => {
  assert.deepEqual(ENV('/d'), { NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_WRAPPER_SKIP_INSTALL: 'true', NX_WORKSPACE_DATA_DIRECTORY: '/d' });
  const d = dataDirFor(path.join('data', 'nx'), path.join(path.sep, 'p'));
  assert.match(path.basename(d), /^[0-9a-f]{12}$/);
  assert.equal(path.dirname(d), path.join('data', 'nx'));
  assert.notEqual(d, dataDirFor(path.join('data', 'nx'), path.join(path.sep, 'q')));
  assert.deepEqual(runArgv(true, 'web', 'build'), [path.join('node_modules', '.bin', 'nx'), 'run', 'web:build']);
  assert.deepEqual(runArgv(false, 'web', 'build'), ['nx', 'run', 'web:build']);
});

test('detect et info : nx.json fichier seulement, nx jamais lancé ; nx local et télémétrie', async () => {
  const marker = path.join(tmp(), 'appelé');
  const spy = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1');`;
  const p = testPlugin(plugin, { bins: { nx: fake(path.join(tmp(), 'nx'), spy) } });
  const none = tmp();
  assert.equal(await p.detect(none), null);
  fs.mkdirSync(path.join(none, 'nx.json'));
  assert.equal(await p.detect(none), null);
  await assert.rejects(p.call(none, 'info'), (e) => e.status === 400 && e.message === 'Pas un espace Nx');
  const ws = workspace('{ "analytics" : true }', spy);
  assert.deepEqual(await p.detect(ws), {});
  assert.deepEqual(await p.call(ws, 'info'), { local: true, telemetry: true });
  assert.deepEqual(await p.call(workspace('{"analytics": false}'), 'info'), { local: false, telemetry: false });
  assert.equal(fs.existsSync(marker), false);
});

test('graph : télémétrie active → nx jamais lancé ; nx absent → indisponible', async () => {
  const marker = path.join(tmp(), 'appelé');
  const spy = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1');`;
  const p = testPlugin(plugin, { bins: { nx: fake(path.join(tmp(), 'nx'), spy) } });
  for (const ws of [workspace('{"analytics":true}', spy), workspace('{\n  "analytics":   true\n}')]) {
    assert.deepEqual(await p.call(ws, 'graph'), { available: true, projects: [], truncated: false, error: TELEMETRY });
  }
  assert.equal(fs.existsSync(marker), false);
  const absent = testPlugin(plugin, { bins: { nx: path.join(tmp(), 'pas-de-nx') } });
  assert.deepEqual(await absent.call(workspace(), 'graph'), { available: false, projects: [], truncated: false, error: null });
  assert.deepEqual(await absent.call(tmp(), 'graph'), { available: true, projects: [], truncated: false, error: 'nx.json introuvable' });
});

test('graph : nx local préféré, arguments et env exacts, cache sous dataDir, stdin fermé, réponse conforme', async () => {
  const dataDir = tmp();
  // Le faux nx range ce qu'il a reçu dans la description d'une cible.
  const local = `let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const e = process.env; const seen = { args: process.argv.slice(2), daemon: e.NX_DAEMON, cloud: e.NX_NO_CLOUD, wrapper: e.NX_WRAPPER_SKIP_INSTALL, data: e.NX_WORKSPACE_DATA_DIRECTORY, ci: e.CI ?? null, input };
  process.stdout.write('avertissement\\n' + JSON.stringify({ graph: { nodes: { app: { name: 'app', type: 'app', data: { root: '.', targets: { t: { metadata: { description: JSON.stringify(seen) } } } } } } } }));
});`;
  const ws = workspace('{}', local);
  const pathNx = fake(path.join(tmp(), 'nx'), `process.stdout.write('{"graph":{"nodes":{}}}');`);
  const p = testPlugin(plugin, { dataDir, bins: { nx: pathNx }, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CI')) });
  const r = await p.call(ws, 'graph'); // testPlugin vérifie la réponse avec NxGraph
  assert.equal(NxGraph.safeParse(r).success, true);
  const seen = JSON.parse(r.projects[0].targets[0].description);
  const data = dataDirFor(dataDir, fs.realpathSync(ws));
  assert.deepEqual(seen, { args: ['graph', '--file=stdout'], daemon: 'false', cloud: 'true', wrapper: 'true', data, ci: null, input: '' }); // CI jamais ajouté
  assert.equal(fs.statSync(data).isDirectory(), true);
  // Sans node_modules/.bin/nx : celui du PATH.
  assert.deepEqual(await p.call(workspace(), 'graph'), { available: true, projects: [], truncated: false, error: null });
});

test('graph : échec de nx (stderr), sortie illisible', async () => {
  const fail = testPlugin(plugin, { bins: { nx: fake(path.join(tmp(), 'nx'), `process.stderr.write('Cannot find project\\n'); process.exit(1);`) } });
  assert.deepEqual(await fail.call(workspace(), 'graph'), { available: true, projects: [], truncated: false, error: 'Cannot find project' });
  const bad = testPlugin(plugin, { bins: { nx: fake(path.join(tmp(), 'nx'), `process.stdout.write('{ tronqué');`) } });
  assert.equal((await bad.call(workspace(), 'graph')).error, 'sortie de nx illisible');
});

test('run : nx.json relu, projet et cible validés (`:`, espace, `-`, antislash refusés), nx local relatif', async () => {
  const marker = path.join(tmp(), 'appelé');
  const spy = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1');`;
  const p = testPlugin(plugin);
  const ws = workspace('{}', spy);
  assert.deepEqual(await p.action(ws, 'run', { params: { project: '@s/web', target: 'build' } }), {
    terminal: { argv: [LOCAL_NX, 'run', '@s/web:build'], title: '@s/web:build', command: `'${LOCAL_NX}' 'run' '@s/web:build'` },
  });
  assert.deepEqual((await p.action(workspace(), 'run', { params: { project: 'web', target: 'serve' } })).terminal.argv, ['nx', 'run', 'web:serve']);
  const refused = [
    [{ project: 'web', target: 'build:prod' }, 'Cible invalide'],
    [{ project: 'a:b', target: 'build' }, 'Projet invalide'],
    [{ project: '-x', target: 'build' }, 'Projet invalide'],
    [{ project: 'web', target: 'a b' }, 'Cible invalide'],
    [{ project: 'w\\x', target: 'build' }, 'Projet invalide'],
    [{ project: 'web', target: 'x\n' }, 'Cible invalide'],
    [{ project: 'web' }, 'Cible invalide'],
    [{ project: 'x'.repeat(201), target: 't' }, 'Projet invalide'],
  ];
  for (const [params, message] of refused) {
    await assert.rejects(p.action(ws, 'run', { params }), (e) => e.status === 400 && e.message === message, JSON.stringify(params));
  }
  assert.equal(NxRunParams.safeParse({ project: 'web', target: 'build' }).success, true);
  await assert.rejects(p.action(tmp(), 'run', { params: { project: 'web', target: 'build' } }), (e) => e.status === 400 && e.message === 'Pas un espace Nx');
  assert.equal(fs.existsSync(marker), false); // le terminal est décrit, jamais lancé ici
});
