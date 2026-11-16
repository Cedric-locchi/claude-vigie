// node --test daemon/*.test.mjs
// Sans Xcode : faux xcodebuild / xcrun / xed (scripts node) écrits dans un dossier temporaire. Passe sous macOS comme sous Linux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Simulator, XcodeBody, XcodeProject, XcodeTargets } from '../contract/index.mjs';
import { shQuote } from './launch.mjs';
import { RUN_SCRIPT, containerArgs, derivedDataDir, openInXcode, parseSchemes, parseSimulators, pickContainer, readXcodeProject, readXcodeTargets, scriptCommand, xcodeCommand } from './xcode.mjs';

const conforme = (schema, v) => assert.deepStrictEqual(schema.parse(v), v);
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-xcode-')));

/** Faux exécutable : `body` est le corps d'un script node (process.argv…). */
function fake(dir, name, body) {
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

const SIMS = JSON.stringify({ devices: {
  'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [{ udid: 'A', name: 'iPhone 15', state: 'Shutdown', isAvailable: true }],
  'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
    { udid: 'C', name: 'iPhone 16 Pro', state: 'Booted', isAvailable: true },
    { udid: 'B', name: 'iPad Air', state: 'Shutdown' },
    { udid: 'X', name: 'Cassé', state: 'Shutdown', isAvailable: false },
  ],
  'com.apple.CoreSimulator.SimRuntime.iOS-18-10': [{ udid: 'D', name: 'iPhone 17', state: 'Shutdown' }],
  'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [{ udid: 'W', name: 'Watch', state: 'Shutdown' }],
} });

test('pickContainer : workspace, puis projet, puis paquet, sinon null ; premier par ordre alphabétique', () => {
  assert.deepEqual(pickContainer(['Package.swift', 'B.xcodeproj', 'Z.xcworkspace', 'A.xcworkspace']), { kind: 'workspace', name: 'A.xcworkspace' });
  assert.deepEqual(pickContainer(['Package.swift', 'B.xcodeproj', 'A.xcodeproj']), { kind: 'project', name: 'A.xcodeproj' });
  assert.deepEqual(pickContainer(['README.md', 'Package.swift']), { kind: 'package', name: 'Package.swift' });
  assert.equal(pickContainer(['package.json', 'src']), null);
  // Nom hostile ignoré (fish : `\'` sortirait des guillemets) ; espace, point, plus et tiret acceptés.
  assert.deepEqual(pickContainer(["a\\'b.xcworkspace", 'My App+1.xcodeproj']), { kind: 'project', name: 'My App+1.xcodeproj' });
  assert.equal(pickContainer(["a\\'b.xcworkspace", "c'd.xcodeproj"]), null);
  assert.equal(XcodeBody.safeParse({ action: 'clean', scheme: "a\\b" }).success, false);
  assert.equal(XcodeBody.safeParse({ action: 'clean', scheme: "a'b" }).success, false);
  assert.equal(XcodeBody.safeParse({ action: 'clean', scheme: 'My App (iOS)' }).success, true);
  assert.deepEqual(containerArgs({ kind: 'package', name: 'Package.swift' }), []);
  assert.deepEqual(containerArgs({ kind: 'project', name: 'A.xcodeproj' }), ['-project', 'A.xcodeproj']);
});

test('parseSchemes : bruit avant le JSON, workspace ou projet, chaînes seulement ; JSON illisible → lève', () => {
  assert.deepEqual(parseSchemes('warning: x\n{"workspace":{"name":"A","schemes":["App","Tests",3]}}'), ['App', 'Tests']);
  assert.deepEqual(parseSchemes('{"project":{"schemes":["P"]}}'), ['P']);
  assert.deepEqual(parseSchemes('{}'), []);
  assert.throws(() => parseSchemes('{"workspace":'));
  assert.throws(() => parseSchemes('rien'));
});

test('parseSimulators : iOS disponibles seulement, runtime décroissant puis nom, booted', () => {
  const sims = parseSimulators(SIMS);
  assert.deepEqual(sims.map((s) => [s.udid, s.runtime, s.booted]), [
    ['D', 'iOS 18.10', false], ['B', 'iOS 18.0', false], ['C', 'iOS 18.0', true], ['A', 'iOS 17.5', false],
  ]);
  for (const s of sims) conforme(Simulator, s);
  assert.throws(() => parseSimulators('{'));
});

test('xcodeCommand : chaîne exacte des 4 actions, paquet, scheme hostile neutralisé', () => {
  const ws = { kind: 'workspace', name: 'App.xcworkspace' };
  const U = '0A1B2C3D-0000-1111-2222-333344445555';
  const base = { scheme: 'App', udid: U, container: ws, derivedData: '/dd' };
  assert.equal(xcodeCommand({ ...base, action: 'build' }), `xcodebuild -workspace 'App.xcworkspace' -scheme 'App' -destination 'platform=iOS Simulator,id=${U}' -derivedDataPath '/dd' build`);
  assert.equal(xcodeCommand({ ...base, action: 'test' }), `xcodebuild -workspace 'App.xcworkspace' -scheme 'App' -destination 'platform=iOS Simulator,id=${U}' -derivedDataPath '/dd' test`);
  assert.equal(xcodeCommand({ ...base, udid: undefined, action: 'clean' }), `xcodebuild -workspace 'App.xcworkspace' -scheme 'App' -derivedDataPath '/dd' clean`);
  assert.equal(xcodeCommand({ ...base, action: 'run' }), `/bin/sh -c ${shQuote(RUN_SCRIPT)} vigie 'App' '${U}' '/dd' -workspace 'App.xcworkspace'`);
  const pkg = { kind: 'package', name: 'Package.swift' };
  assert.equal(xcodeCommand({ ...base, container: pkg, action: 'clean' }), `xcodebuild -scheme 'App' -derivedDataPath '/dd' clean`);
  assert.equal(xcodeCommand({ ...base, container: pkg, action: 'run' }), `/bin/sh -c ${shQuote(RUN_SCRIPT)} vigie 'App' '${U}' '/dd'`);
  // Le script de run est du sh valide.
  execFileSync('/bin/sh', ['-n', '-c', RUN_SCRIPT]);

  // Scheme hostile : exécuté par un vrai shell, il arrive intact à (faux) xcodebuild et rien d'autre ne tourne.
  const dir = tmp();
  fake(dir, 'xcodebuild', `require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));`);
  const scheme = "a'b; $(touch pwned) `touch pwned2`";
  const env = { ...process.env, PATH: dir + path.delimiter + process.env.PATH };
  execFileSync('/bin/sh', ['-c', xcodeCommand({ ...base, scheme, action: 'build' })], { cwd: dir, env });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8')), ['-workspace', 'App.xcworkspace', '-scheme', scheme, '-destination', `platform=iOS Simulator,id=${U}`, '-derivedDataPath', '/dd', 'build']);
  assert.equal(fs.existsSync(path.join(dir, 'pwned')) || fs.existsSync(path.join(dir, 'pwned2')), false);
});

test('scriptCommand et derivedDataDir', () => {
  assert.equal(scriptCommand('x.sh'), `bash ${shQuote(path.join('scripts', 'x.sh'))}`);
  assert.equal(scriptCommand('gen.py'), `python3 ${shQuote(path.join('scripts', 'gen.py'))}`);
  const d = derivedDataDir(path.join('h', 'xcode'), path.join(path.sep, 'p'));
  assert.equal(path.dirname(d), path.join('h', 'xcode'));
  assert.match(path.basename(d), /^[0-9a-f]{12}$/);
  assert.notEqual(d, derivedDataDir(path.join('h', 'xcode'), path.join(path.sep, 'q')));
});

test('readXcodeProject : conteneur, scripts ordinaires non cachés ; dossiers, liens, .rb exclus ; dossier absent', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'App.xcodeproj'));
  const s = path.join(dir, 'scripts');
  fs.mkdirSync(path.join(s, 'sub.sh'), { recursive: true });
  for (const f of ['b.sh', 'a.py', '.cache.sh', 'x.rb', 'sans-extension']) fs.writeFileSync(path.join(s, f), '');
  fs.symlinkSync(path.join(s, 'b.sh'), path.join(s, 'lien.sh'));
  const p = await readXcodeProject(dir);
  assert.deepEqual(p, { container: { kind: 'project', name: 'App.xcodeproj' }, scripts: ['a.py', 'b.sh'] });
  conforme(XcodeProject, p);
  const empty = tmp();
  assert.deepEqual(await readXcodeProject(empty), { container: null, scripts: [] });
  assert.deepEqual(await readXcodeProject(path.join(empty, 'disparu')), { container: null, scripts: [] });
});

test('readXcodeTargets : schemes + simulateurs conformes, flag sans résolution des paquets, stdin fermé', async () => {
  const dir = tmp();
  const xcodebuild = fake(dir, 'xcodebuild', `
let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', () => {
  process.stdout.write('note: bruit\\n' + JSON.stringify({ workspace: { schemes: [JSON.stringify({ args: process.argv.slice(2), input })] } }));
});`);
  const xcrun = fake(dir, 'xcrun', `
if (process.argv.slice(2).join(' ') !== 'simctl list devices available -j') process.exit(3);
process.stdout.write(${JSON.stringify(SIMS)});`);
  const t = await readXcodeTargets(dir, { kind: 'workspace', name: 'A.xcworkspace' }, { bins: { xcodebuild, xcrun } });
  conforme(XcodeTargets, t);
  assert.equal(t.available, true);
  assert.equal(t.error, null);
  assert.deepEqual(JSON.parse(t.schemes[0]), { args: ['-list', '-json', '-disableAutomaticPackageResolution', '-workspace', 'A.xcworkspace'], input: '' });
  assert.equal(t.simulators.length, 4);
});

test('readXcodeTargets : ENOENT, « requires Xcode », timeout, dossier disparu', async () => {
  const dir = tmp();
  const pkg = { kind: 'package', name: 'Package.swift' };
  const xcrun = fake(dir, 'xcrun', `process.stdout.write('{"devices":{}}');`);
  const absent = await readXcodeTargets(dir, pkg, { bins: { xcodebuild: path.join(dir, 'absent'), xcrun } });
  assert.deepEqual(absent, { available: false, schemes: [], simulators: [], error: null });
  conforme(XcodeTargets, absent);

  const clt = fake(dir, 'clt', `process.stderr.write("xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance\\n"); process.exit(1);`);
  const noXcode = await readXcodeTargets(dir, pkg, { bins: { xcodebuild: clt, xcrun } });
  assert.equal(noXcode.available, false);
  assert.match(noXcode.error, /requires Xcode/);
  conforme(XcodeTargets, noXcode);
  const noSimctl = fake(dir, 'nosimctl', `process.stderr.write('xcrun: error: unable to find utility "simctl", not a developer tool or in PATH\\n'); process.exit(72);`);
  assert.equal((await readXcodeTargets(dir, pkg, { bins: { xcodebuild: fake(dir, 'ok', `process.stdout.write('{}')`), xcrun: noSimctl } })).available, false);

  const slow = fake(dir, 'slow', 'setTimeout(() => {}, 10000);');
  const t = await readXcodeTargets(dir, pkg, { bins: { xcodebuild: slow, xcrun }, timeouts: { list: 300 } });
  assert.deepEqual(t, { available: true, schemes: [], simulators: [], error: 'xcodebuild ne répond pas' });

  // Le timeout tue tout le groupe : un petit-fils (`sleep 60` en arrière-plan) ne survit pas.
  const pidFile = path.join(dir, 'petit-fils.pid');
  const parent = fake(dir, 'parent', `const c = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 10000);`);
  const g = await readXcodeTargets(dir, pkg, { bins: { xcodebuild: parent, xcrun }, timeouts: { list: 500 } });
  assert.equal(g.error, 'xcodebuild ne répond pas');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) { // la mort n'est pas instantanée
    try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 20)); } catch (e) { assert.equal(e.code, 'ESRCH'); alive = false; }
  }
  if (alive) process.kill(pid, 'SIGKILL');
  assert.equal(alive, false, 'petit-fils encore vivant après le timeout');

  const long = fake(dir, 'long', `process.stderr.write('x'.repeat(2000)); process.exit(65);`);
  assert.equal((await readXcodeTargets(dir, pkg, { bins: { xcodebuild: long, xcrun } })).error.length, 501);

  assert.equal((await readXcodeTargets(path.join(dir, 'disparu'), pkg, { bins: { xcodebuild: slow, xcrun } })).error, 'dossier introuvable');
});

test('openInXcode : xed reçoit le conteneur (ou le cwd pour un paquet) ; xed absent → erreur', async () => {
  const dir = tmp();
  const out = path.join(dir, 'argv.json');
  const xed = fake(dir, 'xed', `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`);
  assert.deepEqual(await openInXcode(dir, { kind: 'workspace', name: 'A.xcworkspace' }, { bins: { xed } }), { ok: true, error: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [path.join(dir, 'A.xcworkspace')]);
  await openInXcode(dir, { kind: 'package', name: 'Package.swift' }, { bins: { xed } });
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [dir]);
  const ko = await openInXcode(dir, { kind: 'package', name: 'Package.swift' }, { bins: { xed: path.join(dir, 'absent') } });
  assert.equal(ko.ok, false);
});
