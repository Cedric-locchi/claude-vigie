// node --test plugins/*/*.test.mjs
// Sans Xcode : faux xcodebuild / xcrun / xed (scripts node) écrits dans un dossier temporaire. Passe sous macOS comme sous Linux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir, testPlugin } from '../../daemon/plugins.mjs';
import { ScriptParams, XcodeCleanParams, XcodeRunParams } from './contract.mjs';
import plugin, { CLEAN_APPS, RUN_SCRIPT, containerArgs, derivedDataDir, parseSchemes, parseSimulators, pickContainer, readProject, scriptArgv, xcodeArgv } from './index.mjs';

const tmp = () => tempDir('vigie-xcode-'); // effacé à la fin du fichier de test
const U = '0A1B2C3D-0000-1111-2222-333344445555';

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
  // Nom hostile ignoré ; espace, point, plus et tiret acceptés.
  assert.deepEqual(pickContainer(["a\\'b.xcworkspace", 'My App+1.xcodeproj']), { kind: 'project', name: 'My App+1.xcodeproj' });
  assert.equal(pickContainer(["a\\'b.xcworkspace", "c'd.xcodeproj"]), null);
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
  assert.deepEqual(parseSimulators(SIMS).map((s) => [s.udid, s.runtime, s.booted]), [
    ['D', 'iOS 18.10', false], ['B', 'iOS 18.0', false], ['C', 'iOS 18.0', true], ['A', 'iOS 17.5', false],
  ]);
  assert.throws(() => parseSimulators('{'));
});

test('xcodeArgv : argv exact des 4 actions, paquet ; scheme hostile intact après le shell', async () => {
  const ws = { kind: 'workspace', name: 'App.xcworkspace' };
  const base = { scheme: 'App', udid: U, container: ws, derivedData: '/dd' };
  assert.deepEqual(xcodeArgv({ ...base, action: 'build' }), ['xcodebuild', '-workspace', 'App.xcworkspace', '-scheme', 'App', '-destination', `platform=iOS Simulator,id=${U}`, '-derivedDataPath', '/dd', 'build']);
  assert.deepEqual(xcodeArgv({ ...base, action: 'test' }).at(-1), 'test');
  assert.deepEqual(xcodeArgv({ ...base, udid: undefined, action: 'clean' }), ['xcodebuild', '-workspace', 'App.xcworkspace', '-scheme', 'App', '-derivedDataPath', '/dd', 'clean']);
  assert.deepEqual(xcodeArgv({ ...base, action: 'run' }), ['/bin/sh', '-c', RUN_SCRIPT, 'vigie', 'App', U, '/dd', '-workspace', 'App.xcworkspace']);
  const pkg = { kind: 'package', name: 'Package.swift' };
  assert.deepEqual(xcodeArgv({ ...base, container: pkg, action: 'clean' }), ['xcodebuild', '-scheme', 'App', '-derivedDataPath', '/dd', 'clean']);
  assert.deepEqual(xcodeArgv({ ...base, container: pkg, action: 'run' }), ['/bin/sh', '-c', RUN_SCRIPT, 'vigie', 'App', U, '/dd']);
  // Le script de run est du sh valide, sans antislash (le SDK le refuserait).
  execFileSync('/bin/sh', ['-n', '-c', RUN_SCRIPT]);
  assert.equal(RUN_SCRIPT.includes('\\'), false);

  // Scheme hostile : la commande produite par le SDK, exécutée par un vrai shell, le rend intact à (faux) xcodebuild.
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'App.xcworkspace'));
  fake(dir, 'xcodebuild', `require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));`);
  const scheme = "a b; $(touch pwned) `touch pwned2`";
  const r = await testPlugin(plugin, { dataDir: path.join(dir, 'data') }).action(dir, 'build', { params: { scheme, udid: U } });
  const env = { ...process.env, PATH: dir + path.delimiter + process.env.PATH };
  execFileSync('/bin/sh', ['-c', r.terminal.command], { cwd: dir, env });
  const dd = derivedDataDir(path.join(dir, 'data'), dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8')), ['-workspace', 'App.xcworkspace', '-scheme', scheme, '-destination', `platform=iOS Simulator,id=${U}`, '-derivedDataPath', dd, 'build']);
  assert.equal(fs.existsSync(path.join(dir, 'pwned')) || fs.existsSync(path.join(dir, 'pwned2')), false);
  assert.equal(r.terminal.title, `build ${scheme}`);
});

test('scriptArgv et derivedDataDir (sous le dataDir du plugin)', () => {
  assert.deepEqual(scriptArgv('x.sh'), ['bash', path.join('scripts', 'x.sh')]);
  assert.deepEqual(scriptArgv('gen.py'), ['python3', path.join('scripts', 'gen.py')]);
  const d = derivedDataDir(path.join('h', 'plugins-data', 'xcode'), path.join(path.sep, 'p'));
  assert.equal(path.dirname(d), path.join('h', 'plugins-data', 'xcode'));
  assert.match(path.basename(d), /^[0-9a-f]{12}$/);
  assert.notEqual(d, derivedDataDir(path.join('h', 'plugins-data', 'xcode'), path.join(path.sep, 'q')));
});

test('readProject : conteneur, scripts ordinaires non cachés ; dossiers, liens, .rb exclus ; dossier absent', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'App.xcodeproj'));
  const s = path.join(dir, 'scripts');
  fs.mkdirSync(path.join(s, 'sub.sh'), { recursive: true });
  for (const f of ['b.sh', 'a.py', '.cache.sh', 'x.rb', 'sans-extension']) fs.writeFileSync(path.join(s, f), '');
  fs.symlinkSync(path.join(s, 'b.sh'), path.join(s, 'lien.sh'));
  assert.deepEqual(await readProject(dir), { container: { kind: 'project', name: 'App.xcodeproj' }, scripts: ['a.py', 'b.sh'] });
  const empty = tmp();
  assert.deepEqual(await readProject(empty), { container: null, scripts: [] });
  assert.deepEqual(await readProject(path.join(empty, 'disparu')), { container: null, scripts: [] });
});

test('detect et project : conteneur, scripts ; pas iOS → absent, targets 400', async () => {
  const dir = tmp();
  const p = testPlugin(plugin);
  assert.equal(await p.detect(dir), null);
  assert.deepEqual(await p.call(dir, 'project'), { container: null, scripts: [] });
  await assert.rejects(p.call(dir, 'targets'), (e) => e.status === 400 && e.message === 'Pas un projet Xcode');
  fs.mkdirSync(path.join(dir, 'App.xcworkspace'));
  assert.deepEqual(await p.detect(dir), {});
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'seed.sh'), 'echo ok\n');
  assert.deepEqual(await p.call(dir, 'project'), { container: { kind: 'workspace', name: 'App.xcworkspace' }, scripts: ['seed.sh'] });
});

test('targets : schemes + simulateurs, flag sans résolution des paquets, stdin fermé', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'A.xcworkspace'));
  const xcodebuild = fake(dir, 'xcodebuild', `
let input = ''; process.stdin.on('data', (d) => (input += d)).on('end', () => {
  process.stdout.write('note: bruit\\n' + JSON.stringify({ workspace: { schemes: [JSON.stringify({ args: process.argv.slice(2), input })] } }));
});`);
  const xcrun = fake(dir, 'xcrun', `
if (process.argv.slice(2).join(' ') !== 'simctl list devices available -j') process.exit(3);
process.stdout.write(${JSON.stringify(SIMS)});`);
  const t = await testPlugin(plugin, { bins: { xcodebuild, xcrun } }).call(dir, 'targets');
  assert.deepEqual([t.available, t.error, t.simulators.map((s) => s.udid)], [true, null, ['D', 'B', 'C', 'A']]);
  assert.deepEqual(JSON.parse(t.schemes[0]), { args: ['-list', '-json', '-disableAutomaticPackageResolution', '-workspace', 'A.xcworkspace'], input: '' });
});

test('targets : ENOENT, « requires Xcode », simctl absent, erreur longue ; réponses conformes (délai : voir exec dans daemon/plugins.test.mjs)', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'Package.swift'), '');
  const xcrun = fake(dir, 'xcrun', `process.stdout.write('{"devices":{}}');`);
  const targets = (bins) => testPlugin(plugin, { bins: { xcrun, ...bins } }).call(dir, 'targets');
  assert.deepEqual(await targets({ xcodebuild: path.join(dir, 'absent') }), { available: false, schemes: [], simulators: [], error: null });
  const clt = fake(dir, 'clt', `process.stderr.write("xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance\\n"); process.exit(1);`);
  const noXcode = await targets({ xcodebuild: clt });
  assert.equal(noXcode.available, false);
  assert.match(noXcode.error, /requires Xcode/);
  const noSimctl = fake(dir, 'nosimctl', `process.stderr.write('xcrun: error: unable to find utility "simctl", not a developer tool or in PATH\\n'); process.exit(72);`);
  assert.equal((await targets({ xcodebuild: fake(dir, 'ok', `process.stdout.write('{}')`), xcrun: noSimctl })).available, false);
  const long = fake(dir, 'long', `process.stderr.write('x'.repeat(2000)); process.exit(65);`);
  const e = await targets({ xcodebuild: long });
  assert.deepEqual([e.available, e.error.length], [true, 501]);
});

test('contract.mjs : paramètres des actions (regex partagées avec le front)', () => {
  assert.equal(XcodeRunParams.safeParse({ scheme: 'App', udid: U }).success, true);
  assert.equal(XcodeRunParams.safeParse({ scheme: 'App' }).success, false);
  assert.equal(XcodeCleanParams.safeParse({ scheme: 'My App (iOS)' }).success, true);
  for (const scheme of ['-x', "a'b", 'a\\b', 'a\nb', '']) assert.equal(XcodeCleanParams.safeParse({ scheme }).success, false, scheme);
  assert.equal(ScriptParams.safeParse({ name: 'a.py' }).success, true);
  assert.equal(ScriptParams.safeParse({ name: '../x.sh' }).success, false);
});

test('actions xcode : params refusés avant tout terminal, conteneur relu, DerivedData sous dataDir', async () => {
  const dir = tmp();
  const dataDir = path.join(dir, 'data');
  const p = testPlugin(plugin, { dataDir });
  const refuse = async (aid, body, error) => {
    await assert.rejects(p.action(dir, aid, body), (e) => e.status === 400 && e.message === error, `${aid} ${JSON.stringify(body)}`);
  };
  // Dossier non iOS : un corps valide est refusé.
  await refuse('build', { params: { scheme: 'App', udid: U } }, 'Pas un projet Xcode');
  fs.mkdirSync(path.join(dir, 'App.xcodeproj'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'hello.sh'), 'echo bonjour\n');
  await refuse('build', { params: { scheme: 'App', udid: 'pas-un-udid' } }, 'Simulateur invalide');
  await refuse('build', { params: { scheme: 'App', udid: null } }, 'Choisis un simulateur');
  await refuse('build', { params: { scheme: 'App' } }, 'Choisis un simulateur');
  await refuse('run', { params: { scheme: null, udid: U } }, 'Choisis un scheme');
  await refuse('build', { params: { scheme: '-x', udid: U } }, 'Scheme invalide');
  await refuse('build', { params: { scheme: "a\\'b", udid: U } }, 'Scheme invalide');
  await refuse('build', { params: { scheme: "a'b", udid: U } }, 'Scheme invalide');
  await refuse('build', { params: { scheme: 'a\nb', udid: U } }, 'Scheme invalide');
  await refuse('script', { params: { name: '../x.sh' } }, 'Script invalide');
  await refuse('script', { params: { name: 'absent.sh' } }, 'Script inconnu');
  await refuse('script', {}, 'Script invalide');

  const clean = await p.action(dir, 'clean', { params: { scheme: 'My App (iOS)' } });
  const dd = derivedDataDir(dataDir, dir);
  assert.deepEqual(clean.terminal.argv, ['xcodebuild', '-project', 'App.xcodeproj', '-scheme', 'My App (iOS)', '-derivedDataPath', dd, 'clean']);
  assert.ok(dd.startsWith(dataDir + path.sep));
  assert.deepEqual((await p.action(dir, 'run', { params: { scheme: 'App', udid: U } })).terminal.argv.slice(0, 4), ['/bin/sh', '-c', RUN_SCRIPT, 'vigie']);
  assert.deepEqual(await p.action(dir, 'script', { params: { name: 'hello.sh' } }), { terminal: { argv: ['bash', path.join('scripts', 'hello.sh')], title: 'hello.sh', command: `'bash' '${path.join('scripts', 'hello.sh')}'` } });
});

test('méthode open : xed reçoit le conteneur (ou le cwd pour un paquet) ; pas iOS 400 ; xed absent → message', async () => {
  const dir = tmp();
  const out = path.join(dir, 'argv.json');
  const xed = fake(dir, 'xed', `require('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`);
  const p = testPlugin(plugin, { bins: { xed } });
  await assert.rejects(p.call(dir, 'open'), (e) => e.status === 400 && e.message === 'Pas un projet Xcode');
  fs.writeFileSync(path.join(dir, 'Package.swift'), '');
  assert.equal(await p.call(dir, 'open'), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [dir]);
  fs.mkdirSync(path.join(dir, 'A.xcworkspace'));
  await p.call(dir, 'open');
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [path.join(dir, 'A.xcworkspace')]);
  const ko = testPlugin(plugin, { bins: { xed: path.join(dir, 'absent') } });
  await assert.rejects(ko.call(dir, 'open'), (e) => e.status === 400 && e.message === 'xed introuvable (Xcode absent ?)');
});

test("run : les .app d'un autre scheme sont retirés avant la construction, le reste du DerivedData est gardé", () => {
  const dd = tmp();
  const products = path.join(dd, 'Build', 'Products', 'Debug-iphonesimulator');
  fs.mkdirSync(path.join(products, 'Autre.app'), { recursive: true });
  fs.mkdirSync(path.join(products, 'Framework.framework'));
  fs.mkdirSync(path.join(dd, 'Build', 'Intermediates.noindex'));
  execFileSync('/bin/sh', ['-c', CLEAN_APPS, 'vigie'], { env: { ...process.env, DD: dd } });
  assert.deepEqual(fs.readdirSync(products), ['Framework.framework']);
  assert.ok(fs.existsSync(path.join(dd, 'Build', 'Intermediates.noindex')));
  // Avant xcodebuild, sinon on effacerait l'app qu'on vient de construire.
  assert.ok(RUN_SCRIPT.indexOf(CLEAN_APPS) > 0 && RUN_SCRIPT.indexOf(CLEAN_APPS) < RUN_SCRIPT.indexOf('xcodebuild'));
  fs.rmSync(dd, { recursive: true, force: true });
});
