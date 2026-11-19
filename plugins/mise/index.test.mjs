// node --test plugins/*/*.test.mjs
// Sans dépendre de mise : `bins.mise` pointe sur un faux mise (script node) écrit dans un dossier temporaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir, testPlugin } from '../../daemon/plugins.mjs';
import { MiseTasks } from './contract.mjs';
import plugin, { hasProjectTasks, miseError, parseMiseTasks } from './index.mjs';

const tmp = () => tempDir('vigie-mise-'); // effacé à la fin du fichier de test

/** Faux mise : `body` est le corps d'un script node (process.env, process.stdout…). */
function fakeMise(dir, body) {
  const bin = path.join(dir, `fake-mise-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}
const withMise = (bin, opts = {}) => testPlugin(plugin, { bins: { mise: bin }, ...opts });
/** Faux mise qui liste des tâches ; `source` relatif au cwd. */
const listing = (dir, tasks) => fakeMise(dir, `process.stdout.write(JSON.stringify(${JSON.stringify(tasks)}.map((t) => ({ ...t, source: t.source && require('node:path').join(process.cwd(), t.source) }))));`);

test('parseMiseTasks : chemins relatifs, ~/… ou absolus ; objets dans depends/run ; jamais env/secrets/tools', () => {
  const home = path.join(path.sep, 'home', 'u');
  const cwd = path.join(home, 'proj');
  const out = JSON.stringify([
    { name: 'build', aliases: ['b'], description: 'Construit', source: path.join(cwd, 'mise.toml'), depends: ['lint', { task: 'gen', args: ['--x'] }], run: ['npm run build', { tasks: ['a', 'b'] }], file: null, global: false, env: ['SECRET=x'], secrets: ['TOKEN'], tools: { node: '24' } },
    { name: 'glob', source: path.join(home, '.config', 'mise', 'config.toml'), file: path.join(cwd, 'mise-tasks', 'glob'), global: true, run: 'echo' },
    { name: 'ailleurs', source: path.join(path.sep, 'etc', 'mise.toml') },
    { description: 'sans nom' },
    null,
  ]);
  const tasks = parseMiseTasks(out, cwd, home);
  assert.deepEqual(tasks.map((t) => [t.name, t.source, t.file, t.global]), [
    ['build', 'mise.toml', null, false],
    ['glob', path.join('~', '.config', 'mise', 'config.toml'), path.join('mise-tasks', 'glob'), true],
    ['ailleurs', path.join(path.sep, 'etc', 'mise.toml'), null, false],
  ]);
  assert.deepEqual(tasks[0].depends, ['lint', 'gen --x']);
  assert.deepEqual(tasks[0].run, ['npm run build', 'a, b']);
  assert.deepEqual(tasks[1].run, ['echo']);
  for (const t of tasks) for (const k of ['env', 'secrets', 'tools']) assert.equal(k in t, false, k);
  assert.deepEqual(parseMiseTasks('[]', cwd, home), []);
  assert.throws(() => parseMiseTasks('[{"name":', cwd, home));
  assert.throws(() => parseMiseTasks('{"name":"x"}', cwd, home));
});

test('miseError : lignes ERROR sans préfixe, suites gardées, version et conseil --verbose retirés', () => {
  const stderr = [
    'mise WARN  mise version 9 available',
    'mise ERROR error parsing config file: /p/mise.toml',
    'mise ERROR Config files in /p/mise.toml are not trusted.',
    'Trust them with `mise trust`.',
    'mise ERROR Version: 2026.10.11 macos-arm64',
    'mise ERROR Run with --verbose or MISE_VERBOSE=1 for more information',
  ].join('\n');
  assert.equal(miseError(stderr), 'error parsing config file: /p/mise.toml\nConfig files in /p/mise.toml are not trusted.\nTrust them with `mise trust`.');
  assert.equal(miseError(`mise ERROR ${'x'.repeat(800)}`).length, 501);
});

/** Écrit `files` ({ chemin relatif: contenu, null = dossier }) sous `dir`. */
function write(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, ...rel.split('/'));
    if (body === null) { fs.mkdirSync(f, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return dir;
}

test('hasProjectTasks : config qui déclare des tâches ou dossier de tâches, parents compris, jamais au-delà de stop (home)', async () => {
  const home = tmp();
  const at = (files) => write(fs.mkdtempSync(path.join(home, 'p-')), files);
  const yes = [
    { 'mise.toml': '[tools]\nnode = "24"\n\n[tasks.build]\nrun = "x"\n' },
    { '.mise.local.toml': '[tasks]\nbuild = "x"\n' },
    { 'mise.dev.toml': 'tasks.build = "x"\n' },
    { 'mise/config.toml': '[task_config]\nincludes = ["t"]\n' },
    { '.config/mise/config.toml': '  [ tasks."a:b" ]\nrun = "x"\n' },
    { '.config/mise.toml': '[tasks.x]\n' },
    { 'mise-tasks': null }, { '.mise-tasks': null }, { '.mise/tasks': null }, { 'mise/tasks': null }, { '.config/mise/tasks': null },
  ];
  for (const files of yes) assert.equal(await hasProjectTasks(at(files), home), true, JSON.stringify(files));
  const no = [
    {}, { '.tool-versions': 'node 24\n' }, { 'mise.toml': '[tools]\nnode = "24"\n# [tasks]\n' }, { 'mise.toml': null },
    { 'pas-mise.toml': '[tasks]\n' }, { 'mise.toml.bak': '[tasks]\n' }, { 'mise-tasks': 'fichier, pas dossier' },
  ];
  for (const files of no) assert.equal(await hasProjectTasks(at(files), home), false, JSON.stringify(files));
  // Parent : un monorepo dont la racine porte les tâches.
  const root = at({ 'mise.toml': '[tasks.a]\n', 'apps/web/x': '' });
  assert.equal(await hasProjectTasks(path.join(root, 'apps', 'web'), home), true);
  // stop exclu : la config globale (~/.config/mise) ne compte pas.
  write(home, { '.config/mise/config.toml': '[tasks.g]\n', '.config/mise/tasks': null });
  assert.equal(await hasProjectTasks(at({}), home), false);
  assert.equal(await hasProjectTasks(home, home), false);
  assert.equal(await hasProjectTasks(path.join(home, 'disparu'), home), false);
});

test('detect : fichiers seulement, mise jamais lancé, pas de badge ; tasks : mise absent, config non approuvée, globales renvoyées, réponse conforme', async () => {
  const dir = tmp();
  const marker = path.join(dir, 'appelé');
  const spy = withMise(fakeMise(dir, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1');`));
  assert.equal(await spy.detect(dir), null);
  write(dir, { 'mise.toml': '[tasks.a]\nrun = "x"\n' });
  assert.deepEqual(await spy.detect(dir), {});
  assert.deepEqual(await withMise(path.join(dir, 'pas-de-mise')).detect(dir), {}); // l'onglet dira que mise est absent
  assert.equal(fs.existsSync(marker), false);
  const untrusted = withMise(fakeMise(dir, `process.stderr.write('mise ERROR Config files in /p/mise.toml are not trusted.\\nmise ERROR Version: 1\\n'); process.exit(1);`));
  assert.deepEqual(await untrusted.call(dir, 'tasks'), { available: true, untrusted: true, tasks: [], error: 'Config files in /p/mise.toml are not trusted.' });
  assert.deepEqual(await withMise(path.join(dir, 'pas-de-mise')).call(dir, 'tasks'), { available: false, untrusted: false, tasks: [], error: null });
  const p = withMise(listing(dir, [{ name: 'a', source: 'mise.toml' }, { name: 'b', source: 'mise.toml' }, { name: 'g', global: true }]));
  // testPlugin vérifie la réponse avec MiseTasks (result de la méthode) ; les globales restent, le front les filtre.
  const r = await p.call(dir, 'tasks');
  assert.deepEqual(r.tasks.map((t) => [t.name, t.source, t.global]), [['a', 'mise.toml', false], ['b', 'mise.toml', false], ['g', '', true]]);
  assert.equal(MiseTasks.safeParse(r).success, true);
  const bad = withMise(fakeMise(dir, `process.stdout.write('[{');`));
  assert.equal((await bad.call(dir, 'tasks')).error, 'sortie de mise illisible');
});

test('lecture : env sans MISE_YES, hors ligne, arguments fixes, stdin fermé', async () => {
  const dir = tmp();
  const bin = fakeMise(dir, `
let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', () => {
  process.stdout.write(JSON.stringify([{ name: 'x', source: process.cwd() + '/mise.toml', description: JSON.stringify({ yes: process.env.MISE_YES ?? null, offline: process.env.MISE_OFFLINE, hide: process.env.MISE_HIDE_UPDATE_WARNING, args: process.argv.slice(2), input }) }]));
});`);
  const r = await withMise(bin, { env: { ...process.env, MISE_YES: '1' } }).call(dir, 'tasks');
  assert.deepEqual(JSON.parse(r.tasks[0].description), { yes: null, offline: '1', hide: '1', args: ['tasks', 'ls', '--json'], input: '' });
});

test('actions : run relit la liste (nom ou alias), inconnu ou en - refusé ; trust au clic', async () => {
  const dir = tmp();
  const p = withMise(listing(dir, [{ name: 'test', aliases: ['t'], source: 'mise.toml' }, { name: '-x', source: 'mise.toml' }, { name: 'a\\b', source: 'mise.toml' }]));
  for (const task of ['inconnue', "test'; rm -rf ~", '-x']) {
    await assert.rejects(p.action(dir, 'run', { params: { task } }), (e) => e.status === 400 && e.message === 'Tâche mise inconnue', task);
  }
  await assert.rejects(p.action(dir, 'run', { params: { task: 42 } }), (e) => e.status === 400 && e.message === 'Tâche mise inconnue');
  await assert.rejects(p.action(dir, 'run', {}), (e) => e.status === 400);
  // Antislash : refusé par le SDK (fish), jamais quoté de travers.
  await assert.rejects(p.action(dir, 'run', { params: { task: 'a\\b' } }), (e) => e.status === 400);
  assert.deepEqual(await p.action(dir, 'run', { params: { task: 't' } }), { terminal: { argv: ['mise', 'run', 'test'], title: 'test', command: `'mise' 'run' 'test'` } });
  assert.deepEqual(await p.action(dir, 'trust', { params: { task: 'ignoré' } }), { terminal: { argv: ['mise', 'trust'], title: 'mise trust', command: `'mise' 'trust'` } });
});
