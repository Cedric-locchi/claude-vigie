// node --test daemon/*.test.mjs
// Sans dépendre de mise : `bin` pointe sur un faux mise (script node) écrit dans un dossier temporaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MiseTasks } from '../contract/index.mjs';
import { miseError, parseMiseTasks, readMiseTasks } from './mise.mjs';

const conforme = (schema, v) => assert.deepStrictEqual(schema.parse(v), v);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-mise-')));

/** Faux mise : `body` est le corps d'un script node (process.env, process.stdout…). */
function fakeMise(dir, body) {
  const bin = path.join(dir, 'fake-mise');
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

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
  conforme(MiseTasks, { available: true, untrusted: false, tasks, error: null });
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

test('readMiseTasks : mise absent, dossier disparu', async () => {
  const dir = tmp();
  const absent = await readMiseTasks(dir, { bin: path.join(dir, 'pas-de-mise') });
  assert.deepEqual(absent, { available: false, untrusted: false, tasks: [], error: null });
  conforme(MiseTasks, absent);
  const gone = await readMiseTasks(path.join(dir, 'disparu'), { bin: path.join(dir, 'pas-de-mise') });
  assert.deepEqual(gone, { available: true, untrusted: false, tasks: [], error: 'dossier introuvable' });
});

test('readMiseTasks : config non approuvée (rc 1), WARN ignoré en rc 0, sortie illisible, timeout', async () => {
  const dir = tmp();
  const untrusted = await readMiseTasks(dir, { bin: fakeMise(dir, `
process.stderr.write('mise ERROR Config files in /p/mise.toml are not trusted.\\nmise ERROR Version: 1\\n'); process.exit(1);`) });
  assert.deepEqual(untrusted, { available: true, untrusted: true, tasks: [], error: 'Config files in /p/mise.toml are not trusted.' });
  conforme(MiseTasks, untrusted);

  const warn = await readMiseTasks(dir, { bin: fakeMise(dir, `
process.stderr.write('mise WARN  tracking config: failed\\n');
process.stdout.write(JSON.stringify([{ name: 't', source: process.cwd() + '/mise.toml', env: ['A=1'] }]));`) });
  assert.equal(warn.error, null);
  assert.deepEqual(warn.tasks.map((t) => [t.name, t.source]), [['t', 'mise.toml']]);
  conforme(MiseTasks, warn);

  const bad = await readMiseTasks(dir, { bin: fakeMise(dir, `process.stdout.write('[{');`) });
  assert.equal(bad.error, 'sortie de mise illisible');

  const slow = await readMiseTasks(dir, { timeout: 300, bin: fakeMise(dir, 'setTimeout(() => {}, 10000);') });
  assert.deepEqual(slow, { available: true, untrusted: false, tasks: [], error: 'mise ne répond pas' });
});

test('readMiseTasks : env transmis tel quel, stdin fermé, arguments fixes', async () => {
  const dir = tmp();
  const bin = fakeMise(dir, `
let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', () => {
  process.stdout.write(JSON.stringify([{ name: JSON.stringify({ yes: process.env.MISE_YES ?? null, offline: process.env.MISE_OFFLINE, args: process.argv.slice(2), input }) }]));
});`);
  const r = await readMiseTasks(dir, { bin, env: { PATH: process.env.PATH, MISE_OFFLINE: '1' } });
  assert.deepEqual(JSON.parse(r.tasks[0].name), { yes: null, offline: '1', args: ['tasks', 'ls', '--json'], input: '' });
});
