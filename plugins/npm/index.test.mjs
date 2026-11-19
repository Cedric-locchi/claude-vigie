// node --test plugins/*/*.test.mjs
// Aucun process : le plugin ne lit que des fichiers, écrits ici dans des dossiers temporaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDir, testPlugin } from '../../daemon/plugins.mjs';
import { NpmProject, NpmRunParams } from './contract.mjs';
import plugin, { detectManager, parsePnpmWorkspace, runArgv, scriptsOf, workspaceGlobs, workspacePatterns } from './index.mjs';

const tmp = () => tempDir('vigie-npm-'); // effacé à la fin du fichier de test
const p = testPlugin(plugin);

/** Écrit `files` ({ chemin relatif: contenu, objet = JSON }) sous `dir`. */
function write(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

test('detectManager : packageManager, sinon lockfile par priorité ; désaccords signalés ; null sans trace', () => {
  assert.equal(detectManager({}, ['src', 'package.json']), null);
  assert.deepEqual(detectManager({ packageManager: 'pnpm@9.1.0' }, []), { pm: 'pnpm', from: 'packageManager', warning: null });
  assert.deepEqual(detectManager({ packageManager: 'yarn@4.0.0+sha512.abc' }, ['package-lock.json']), { pm: 'yarn', from: 'packageManager', warning: 'packageManager (yarn) en désaccord avec package-lock.json' });
  assert.deepEqual(detectManager({}, ['pnpm-workspace.yaml', 'pnpm-lock.yaml']), { pm: 'pnpm', from: 'pnpm-lock.yaml', warning: null });
  assert.deepEqual(detectManager(null, ['bun.lockb']), { pm: 'bun', from: 'bun.lockb', warning: null });
  assert.deepEqual(detectManager({}, ['npm-shrinkwrap.json']), { pm: 'npm', from: 'npm-shrinkwrap.json', warning: null });
  assert.deepEqual(detectManager({}, ['package-lock.json', 'yarn.lock']), { pm: 'yarn', from: 'yarn.lock', warning: 'Plusieurs gestionnaires (yarn.lock, package-lock.json) : yarn retenu' });
  assert.deepEqual(detectManager({ packageManager: 'deno@2' }, ['bun.lock']), { pm: 'bun', from: 'bun.lock', warning: 'packageManager « deno@2 » non reconnu' });
  assert.deepEqual(detectManager({ packageManager: 'deno@2' }, []), { pm: 'npm', from: 'par défaut', warning: 'packageManager « deno@2 » non reconnu' });
});

test('parsePnpmWorkspace et workspacePatterns : liste en bloc ou en ligne, commentaires ; pnpm lit le yaml, les autres package.json', () => {
  const yaml = "# racine\npackages:\n  # apps\n  - 'apps/*'\n  - \"libs/**\" # toutes\n  - tools\n\n  - '!**/test/**'\ncatalog:\n  - pas-moi\n";
  assert.deepEqual(parsePnpmWorkspace(yaml), ['apps/*', 'libs/**', 'tools', '!**/test/**']);
  assert.deepEqual(parsePnpmWorkspace("packages: ['a/*', \"b\"] # x\n"), ['a/*', 'b']);
  assert.deepEqual(parsePnpmWorkspace('packages:\n- a\n- b\n'), ['a', 'b']);
  assert.deepEqual(parsePnpmWorkspace('onlyBuiltDependencies:\n  - esbuild\n'), []);
  assert.deepEqual(workspacePatterns({ workspaces: ['x/*'] }, 'pnpm', 'packages:\n  - y/*\n'), ['y/*']);
  assert.deepEqual(workspacePatterns({ workspaces: ['x/*', 3] }, 'pnpm', null), ['x/*']);
  assert.deepEqual(workspacePatterns({ workspaces: { packages: ['p/*'], nohoist: ['z'] } }, 'yarn', 'packages:\n  - y/*\n'), ['p/*']);
  assert.deepEqual(workspacePatterns({ workspaces: 'x' }, 'npm', null), []);
});

test('workspaceGlobs : négations en exclude, absolu / .. / antislash refusés, node_modules et cachés exclus', () => {
  const g = workspaceGlobs(['packages/*', './apps/', '!packages/legacy', '/etc', '../ailleurs', 'a/../../b', 'a\\b', '.', '']);
  assert.deepEqual(g.include, ['packages/*/package.json', 'apps/package.json']);
  assert.deepEqual(g.exclude, ['**/node_modules', '**/node_modules/**', '**/.*', '**/.*/**', 'packages/legacy']);
  assert.deepEqual(g.refused, ['/etc', '../ailleurs', 'a/../../b', 'a\\b', '']);
});

test('runArgv : syntaxe exacte de chaque gestionnaire, jamais npx', () => {
  assert.deepEqual(runArgv('npm', 'build', null), ['npm', 'run', 'build']);
  assert.deepEqual(runArgv('npm', 'build', '@a/web'), ['npm', 'run', '--workspace=@a/web', 'build']);
  assert.deepEqual(runArgv('pnpm', 'build', null), ['pnpm', 'run', 'build']);
  assert.deepEqual(runArgv('pnpm', 'build', 'web'), ['pnpm', '--filter', 'web', 'run', 'build']);
  assert.deepEqual(runArgv('yarn', 'build', null), ['yarn', 'run', 'build']);
  assert.deepEqual(runArgv('yarn', 'build', 'web'), ['yarn', 'workspace', 'web', 'run', 'build']);
  assert.deepEqual(runArgv('bun', 'build', null), ['bun', 'run', 'build']);
  assert.deepEqual(runArgv('bun', 'build', 'web'), ['bun', 'run', '--filter', 'web', 'build']);
});

test('scriptsOf : budget en octets de JSON (accents, échappements), pas en caractères', () => {
  const pkg = { scripts: { a: 'é'.repeat(10), b: 'é'.repeat(10), c: 'x' } };
  // « a » + 10 « é » : 11 caractères, mais 21 octets + 2 guillemets = 23.
  let budget = { left: 46, truncated: false };
  assert.deepEqual([scriptsOf(pkg, budget).map((s) => s.name), budget.truncated], [['a', 'b'], true]);
  budget = { left: 22, truncated: false };
  assert.deepEqual([scriptsOf(pkg, budget).map((s) => s.name), budget.truncated], [[], true]);
  budget = { left: 50, truncated: false };
  assert.deepEqual([scriptsOf(pkg, budget).map((s) => s.name), budget.truncated], [['a', 'b', 'c'], false]);
  // Guillemets échappés : `"` vaut 2 octets dans la réponse (q + 4 × 2 + 2 = 11).
  budget = { left: 10, truncated: false };
  assert.deepEqual([scriptsOf({ scripts: { q: '""""' } }, budget).length, budget.truncated], [0, true]);
});

test('detect : package.json objet seulement', async () => {
  const dir = tmp();
  assert.equal(await p.detect(dir), null);
  write(dir, { 'package.json': '[1]' });
  assert.equal(await p.detect(dir), null);
  write(dir, { 'package.json': '{"name":"x"}' });
  assert.deepEqual(await p.detect(dir), {});
});

test('project : scripts racine et workspaces (glob, négation, node_modules, cachés, sans nom, doublons), réponse conforme', async () => {
  const dir = write(tmp(), {
    'package.json': { name: 'root', workspaces: ['packages/*', 'apps/**', '!packages/legacy', '../dehors'], scripts: { build: 'tsc', '-x': 'non', 'a\\b': 'non', lint: 42, long: 'y'.repeat(3000) } },
    'package-lock.json': '{}',
    'packages/a/package.json': { name: '@s/a', scripts: { test: 'node --test' } },
    'packages/b/package.json': { name: '@s/a' }, // doublon de nom : ignoré
    'packages/legacy/package.json': { name: 'legacy' },
    'packages/sans-nom/package.json': { scripts: { x: 'y' } },
    'packages/mauvais/package.json': { name: '-oups' },
    'packages/node_modules/package.json': { name: 'nm' },
    'apps/web/node_modules/dep/package.json': { name: 'dep' },
    'apps/.cache/package.json': { name: 'cache' },
    'apps/web/package.json': { name: 'web', scripts: { dev: 'vite' } },
    'apps/web/src/package.json': '{ tronqué',
  });
  const r = await p.call(dir, 'project'); // testPlugin vérifie la réponse avec NpmProject
  assert.equal(NpmProject.safeParse(r).success, true);
  assert.deepEqual({ ...r, scripts: r.scripts.map((s) => [s.name, s.command.length]) }, {
    pm: 'npm', from: 'package-lock.json', warning: 'Motifs de workspace refusés : ../dehors',
    scripts: [['build', 3], ['long', 2001]],
    workspaces: [
      { name: 'web', dir: path.join('apps', 'web'), scripts: [{ name: 'dev', command: 'vite' }] },
      { name: '@s/a', dir: path.join('packages', 'a'), scripts: [{ name: 'test', command: 'node --test' }] },
    ],
    truncated: false, error: null,
  });
});

test('project : pnpm lit pnpm-workspace.yaml ; gestionnaire remonté jusqu\'à .git, pas au-delà', async () => {
  const root = write(tmp(), {
    'yarn.lock': '', // au-dessus de .git : jamais lu
    'repo/.git/HEAD': '',
    'repo/pnpm-lock.yaml': '',
    'repo/pnpm-workspace.yaml': 'packages:\n  - libs/*\n',
    'repo/package.json': { workspaces: ['ignoré/*'] },
    'repo/libs/x/package.json': { name: 'x', scripts: { t: 'vitest' } },
    'repo/libs/x/deep/package.json': { name: 'deep' },
    'solo/package.json': { scripts: {} },
  });
  const repo = path.join(root, 'repo');
  const r = await p.call(repo, 'project');
  assert.deepEqual([r.pm, r.from, r.workspaces.map((w) => w.name)], ['pnpm', 'pnpm-lock.yaml', ['x']]);
  const sub = await p.call(path.join(repo, 'libs', 'x'), 'project');
  assert.deepEqual([sub.pm, sub.from, sub.scripts], ['pnpm', path.join('..', '..', 'pnpm-lock.yaml'), [{ name: 't', command: 'vitest' }]]);
  // Sans .git ni lockfile : remonte jusqu'au tmp (yarn.lock du dossier parent).
  assert.deepEqual([(await p.call(path.join(root, 'solo'), 'project')).from], [path.join('..', 'yarn.lock')]);
  // .git dans solo : la remontée s'arrête là, npm par défaut.
  write(root, { 'solo/.git/HEAD': '' });
  const solo = await p.call(path.join(root, 'solo'), 'project');
  assert.deepEqual([solo.pm, solo.from], ['npm', 'par défaut']);
  write(root, { 'solo/package.json': { packageManager: 'bun@1.2.0' } });
  assert.deepEqual((await p.call(path.join(repo, '..', 'solo'), 'project')).from, 'packageManager');
});

test('project : un lien qui sort du dossier est ignoré ; package.json absent, illisible ou trop gros ; plafond de 200', async () => {
  const outside = write(tmp(), { 'pkg/package.json': { name: 'dehors', scripts: { x: 'rm' } } });
  const dir = write(tmp(), { 'package.json': { workspaces: ['packages/*', 'lien'] }, 'packages/in/package.json': { name: 'in' } });
  fs.symlinkSync(path.join(outside, 'pkg'), path.join(dir, 'lien'));
  fs.symlinkSync(path.join(outside, 'pkg'), path.join(dir, 'packages', 'lien2'));
  assert.deepEqual((await p.call(dir, 'project')).workspaces.map((w) => w.name), ['in']);

  const empty = tmp();
  assert.equal((await p.call(empty, 'project')).error, 'package.json introuvable');
  write(empty, { 'package.json': '{ "name":' });
  assert.equal((await p.call(empty, 'project')).error, 'package.json illisible');
  write(empty, { 'package.json': `{"x":"${'a'.repeat(1024 * 1024)}"}` });
  assert.equal((await p.call(empty, 'project')).error, 'package.json illisible');
  assert.equal((await p.call(path.join(empty, 'absent'), 'project')).error, 'dossier introuvable');

  const many = write(tmp(), { 'package.json': { workspaces: ['p/*'] } });
  for (let i = 0; i < 201; i++) write(many, { [`p/w${String(i).padStart(3, '0')}/package.json`]: { name: `w${i}` } });
  const r = await p.call(many, 'project');
  assert.deepEqual([r.workspaces.length, r.truncated], [200, true]);
});

test('run : relecture, script ou workspace inconnus refusés, argv du gestionnaire du dépôt', async () => {
  const dir = write(tmp(), {
    'package.json': { workspaces: ['packages/*'], scripts: { build: 'tsc', '-x': 'non' } },
    'yarn.lock': '',
    'packages/a/package.json': { name: '@s/a', scripts: { test: 'jest' } },
  });
  assert.deepEqual(await p.action(dir, 'run', { params: { script: 'build' } }), { terminal: { argv: ['yarn', 'run', 'build'], title: 'build', command: `'yarn' 'run' 'build'` } });
  assert.deepEqual((await p.action(dir, 'run', { params: { script: 'test', workspace: '@s/a' } })).terminal.argv, ['yarn', 'workspace', '@s/a', 'run', 'test']);
  assert.deepEqual((await p.action(dir, 'run', { params: { script: 'build', workspace: null } })).terminal.argv, ['yarn', 'run', 'build']);
  const refused = [
    [{ script: 'test' }, 'Script inconnu'], // script d'un workspace demandé à la racine
    [{ script: '-x' }, 'Script inconnu'],
    [{ script: 'build; rm -rf ~' }, 'Script inconnu'],
    [{ script: 'constructor' }, 'Script inconnu'],
    [{ script: 'test', workspace: 'b' }, 'Workspace inconnu'],
    [{ script: 'test', workspace: '../a' }, 'Workspace inconnu'],
    [{ script: 42 }, 'Script inconnu'],
    [{}, 'Script inconnu'],
    [{ script: 'build', workspace: 3 }, 'Workspace inconnu'],
  ];
  for (const [params, message] of refused) {
    await assert.rejects(p.action(dir, 'run', { params }), (e) => e.status === 400 && e.message === message, JSON.stringify(params));
  }
  assert.equal(NpmRunParams.safeParse({ script: 'x', workspace: null }).success, true);
  // Relecture : un script retiré du package.json entre la lecture et le clic est refusé.
  write(dir, { 'package.json': { scripts: {} } });
  await assert.rejects(p.action(dir, 'run', { params: { script: 'build' } }), (e) => e.status === 400 && e.message === 'Script inconnu');
  await assert.rejects(p.action(tmp(), 'run', { params: { script: 'build' } }), (e) => e.status === 400 && e.message === 'package.json introuvable');
});
