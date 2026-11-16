import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commitAll, createBranch, headBranch, parseStatus, readGitDiff, readWorktreeFile, restoreFile, splitPatch, untrackedPatch, writeWorktreeFile } from './git.mjs';
import { FileBody, GitDiff } from '../contract/index.mjs';

// Sortie conforme au contrat : parse retire les clés inconnues, donc l'égalité échoue sur un champ manquant comme sur un champ en trop.
const conforme = (S, v) => { const j = JSON.parse(JSON.stringify(v)); assert.deepStrictEqual(S.parse(j), j); };

test('parseStatus : modifié, indexé, renommé, non suivi', () => {
  const files = parseStatus(' M a.js\0M  b.js\0R  new.js\0old.js\0?? n.txt\0 D gone.js\0');
  assert.deepEqual(files.map((f) => [f.path, f.status, f.staged, f.unstaged]), [
    ['a.js', 'M', false, true], ['b.js', 'M', true, false], ['new.js', 'R', true, false], ['n.txt', '?', false, true], ['gone.js', 'D', false, true],
  ]);
  assert.equal(files[2].from, 'old.js');
});

test('readGitDiff : patchs et compteurs sur un vrai dépôt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-git-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\ndeux\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\n2\ntrois\n');
  fs.writeFileSync(path.join(dir, 'neuf.txt'), 'bonjour\n');
  fs.mkdirSync(path.join(dir, 'sous'));

  const d = await readGitDiff(path.join(dir, 'sous'));
  conforme(GitDiff, d);
  assert.equal(d.repo, true);
  const a = d.files.find((f) => f.path === 'a.txt');
  assert.deepEqual([a.status, a.added, a.removed], ['M', 2, 1]);
  assert.match(a.patch, /^\+trois$/m);
  const n = d.files.find((f) => f.path === 'neuf.txt');
  assert.deepEqual([n.status, n.added], ['?', 1]);

  const none = await readGitDiff(fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-nogit-')));
  conforme(GitDiff, none);
  assert.equal(none.repo, false);
});

test('restoreFile : modifié, ajouté, non suivi ; refuse un chemin hors status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-git-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'deux\n'); g('add', 'a.txt');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n'); g('add', 'b.txt');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');

  for (const p of ['a.txt', 'b.txt', 'c.txt']) await restoreFile(dir, p);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'un\n');
  assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'c.txt')), false);
  assert.equal((await readGitDiff(dir)).total, 0);
  await assert.rejects(restoreFile(dir, '../../etc/passwd'), /non modifié/);
});

test('commitAll : indexe tout et commite ; refuse un message vide', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-git-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir }).toString();
  g('init', '-q');
  g('config', 'user.name', 't'); g('config', 'user.email', 't@t'); g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  await assert.rejects(commitAll(dir, '  '), /vide/);
  await commitAll(dir, 'feat: premier');
  assert.equal(g('log', '--format=%s').trim(), 'feat: premier');
  assert.equal((await readGitDiff(dir)).total, 0);
});

test('createBranch : bascule sur la nouvelle branche avec les modifs ; refuse un nom invalide ou déjà pris', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-git-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'deux\n');
  await createBranch(dir, 'feat/x');
  const d = await readGitDiff(dir);
  assert.equal(d.branch, 'feat/x');
  assert.equal(d.total, 1); // la modif a suivi
  await assert.rejects(createBranch(dir, 'feat/x'));
  await assert.rejects(createBranch(dir, 'a..b'));
});

test('splitPatch : un patch par chemin ; renommage, espaces, chemin entre guillemets', () => {
  const out = [
    'diff --git a/old.txt b/n w.txt', 'similarity index 100%', 'rename from old.txt', 'rename to n w.txt',
    'diff --git a/x y.txt b/x y.txt', 'index 7898192..422c2b7 100644', '--- a/x y.txt\t', '+++ b/x y.txt\t', '@@ -1 +1,2 @@', ' a', '+b',
    'diff --git "a/t\\tab\\303\\251" "b/t\\tab\\303\\251"', 'deleted file mode 100644', 'index 1..0', '--- "a/t\\tab\\303\\251"', '+++ /dev/null', '@@ -1 +0,0 @@', '-diff --git a/faux b/faux', '',
  ].join('\n');
  const m = splitPatch(out);
  assert.deepEqual([...m.keys()], ['n w.txt', 'x y.txt', 't\tabé']);
  assert.match(m.get('n w.txt'), /^rename from old.txt$/m);
  assert.match(m.get('x y.txt'), /^\+b$/m);
  assert.match(m.get('t\tabé'), /^-diff --git a\/faux b\/faux$/m); // une ligne de contenu ne coupe pas le patch
  assert.equal(splitPatch('').size, 0);
});

test('readGitDiff : modifié, renommé, non suivi et chemin avec espace en un seul git diff ; cache invalidé par un commit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-git-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir }).toString();
  g('init', '-q');
  g('config', 'user.name', 't'); g('config', 'user.email', 't@t'); g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'un\n');
  fs.writeFileSync(path.join(dir, 'x y.txt'), 'x\n');
  fs.writeFileSync(path.join(dir, 'old.txt'), 'garde\nmoi\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'deux\n');
  fs.writeFileSync(path.join(dir, 'x y.txt'), 'x\ny\n');
  g('mv', 'old.txt', 'new.txt');
  fs.writeFileSync(path.join(dir, 'u v.txt'), 'l1\nl2'); // non suivi, sans fin de ligne
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 0, 2]));

  const d = await readGitDiff(dir);
  conforme(GitDiff, d);
  const by = Object.fromEntries(d.files.map((f) => [f.path, f]));
  assert.deepEqual([by['a.txt'].status, by['a.txt'].added, by['a.txt'].removed], ['M', 1, 1]);
  assert.deepEqual([by['x y.txt'].status, by['x y.txt'].added], ['M', 1]);
  assert.deepEqual([by['new.txt'].status, by['new.txt'].from, by['new.txt'].added, by['new.txt'].removed], ['R', 'old.txt', 0, 0]);
  assert.match(by['new.txt'].patch, /^rename from old\.txt$/m);
  assert.equal(by['bin.dat'].added, 0);
  // Le patch d'un non suivi est celui de `git diff --no-index`, à la ligne `index` près (hash non calculé).
  for (const f of ['u v.txt', 'bin.dat']) {
    let ref;
    try { execFileSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: dir }); } catch (e) { ref = e.stdout.toString(); }
    assert.equal(by[f].patch, ref.replace(/^index .*\n/m, ''));
  }
  assert.deepEqual([by['u v.txt'].added, by['u v.txt'].truncated], [2, false]);

  // Cache : appels rapprochés servis par la même requête, même si le disque a bougé entre-temps.
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  assert.equal(await readGitDiff(dir), d);
  await commitAll(dir, 'feat: tout');
  const after = await readGitDiff(dir);
  assert.notEqual(after, d);
  assert.equal(after.total, 0);
});

test('untrackedPatch : fichier trop gros tronqué, vide sans hunk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-git-'));
  fs.writeFileSync(path.join(dir, 'gros.txt'), 'abcdefghi\n'.repeat(20_000));
  const big = await untrackedPatch(dir, 'gros.txt');
  assert.equal(big.truncated, true);
  assert.ok(big.patch.length > 90_000);
  fs.writeFileSync(path.join(dir, 'vide'), '');
  assert.deepEqual(await untrackedPatch(dir, 'vide'), { patch: 'diff --git a/vide b/vide\nnew file mode 100644\n', truncated: false });
});

/** Dépôt avec a.txt commité puis modifié ; renvoie le dossier et un raccourci git. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-edit-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
  g('init', '-q');
  for (const f of ['a.txt', 'gone.txt', 'bin.dat', 'gros.txt', 'latin.txt', 'run.sh', 'crlf.txt']) fs.writeFileSync(path.join(dir, f), 'v1\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v2\n');
  return { dir, g };
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('readWorktreeFile : modifié et non suivi, empreinte = sha256 des octets', async () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'neuf.txt'), 'bonjour\n');
  for (const [p, content] of [['a.txt', 'v2\n'], ['neuf.txt', 'bonjour\n']]) {
    const f = await readWorktreeFile(dir, p);
    conforme(FileBody, f);
    assert.deepEqual(f, { path: p, content, hash: sha(Buffer.from(content)) });
  }
});

test('readWorktreeFile : refuse hors status, sortie du dépôt, supprimé, binaire, trop gros, non UTF-8, lien', async () => {
  const { dir } = repo();
  fs.rmSync(path.join(dir, 'gone.txt'));
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(dir, 'gros.txt'), 'x'.repeat(100_001));
  fs.writeFileSync(path.join(dir, 'latin.txt'), Buffer.from([0xff]));
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-out-')), 'secret.txt');
  fs.writeFileSync(outside, 'secret\n');
  fs.symlinkSync(outside, path.join(dir, 'lien.txt'));
  for (const [p, re] of [['b.txt', /non modifié/], ['../../etc/passwd', /non modifié/], ['gone.txt', /supprimé/], ['bin.dat', /binaire/],
    ['gros.txt', /volumineux/], ['latin.txt', /UTF-8/], ['lien.txt', /ordinaire/]]) {
    await assert.rejects(readWorktreeFile(dir, p), (e) => re.test(e.message) && e.status === 400, p);
  }
  const h = sha(Buffer.from('x'));
  await assert.rejects(writeWorktreeFile(dir, 'lien.txt', 'pirate', h), /ordinaire/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'secret\n'); // cible intacte
});

test('writeWorktreeFile : contenu, mode, CRLF + BOM à l’octet près, vide ; empreinte périmée 412 ; cache invalidé', async () => {
  const { dir } = repo();
  const file = (p) => path.join(dir, p);
  const write = async (p, content) => writeWorktreeFile(dir, p, content, (await readWorktreeFile(dir, p)).hash);

  const before = await readGitDiff(dir);
  await write('a.txt', 'v3\n');
  assert.equal(fs.readFileSync(file('a.txt'), 'utf8'), 'v3\n');
  const after = await readGitDiff(dir);
  assert.notEqual(after, before);
  assert.match(after.files.find((f) => f.path === 'a.txt').patch, /^\+v3$/m);

  fs.writeFileSync(file('run.sh'), '#!/bin/sh\n'); fs.chmodSync(file('run.sh'), 0o755);
  await write('run.sh', '#!/bin/sh\necho ok\n');
  assert.equal(fs.statSync(file('run.sh')).mode & 0o777, 0o755);

  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('l1\r\nl2\r\n')]);
  fs.writeFileSync(file('crlf.txt'), bom);
  const f = await readWorktreeFile(dir, 'crlf.txt');
  await writeWorktreeFile(dir, 'crlf.txt', f.content, f.hash);
  assert.deepEqual(fs.readFileSync(file('crlf.txt')), bom);

  await write('a.txt', '');
  assert.equal(fs.readFileSync(file('a.txt'), 'utf8'), '');

  const stale = (await readWorktreeFile(dir, 'run.sh')).hash;
  fs.writeFileSync(file('run.sh'), 'changé par Claude\n');
  await assert.rejects(writeWorktreeFile(dir, 'run.sh', 'écrasé', stale), (e) => e.status === 412);
  assert.equal(fs.readFileSync(file('run.sh'), 'utf8'), 'changé par Claude\n');
  await assert.rejects(writeWorktreeFile(dir, 'run.sh', 'x'.repeat(100_001), stale), /volumineux/);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

test('writeWorktreeFile : refuse d’écrire sous <home>/.claude (403), lien compris', async () => {
  const { dir } = repo();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-home-'));
  fs.symlinkSync(dir, path.join(home, '.claude')); // ~/.claude qui mène au dépôt : la cible résolue est protégée
  const { hash } = await readWorktreeFile(dir, 'a.txt');
  await assert.rejects(writeWorktreeFile(dir, 'a.txt', 'pirate\n', hash, home), (e) => e.status === 403 && /lecture seule/.test(e.message));
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v2\n');
  await writeWorktreeFile(dir, 'a.txt', 'v3\n', hash, fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-home-')));
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v3\n');
});

test('headBranch : branche nommée, HEAD détachée, .git fichier relatif, worktree réel, hors dépôt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-head-'));
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  g('init', '-q', '-b', 'feat/x');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', '.'); g('commit', '-qm', 'init');
  assert.equal(await headBranch(dir), 'feat/x');

  g('worktree', 'add', '-q', '-b', 'wt', path.join(tmp, 'wt'));
  assert.equal(await headBranch(path.join(tmp, 'wt')), 'wt');

  // .git fichier avec gitdir relatif au dossier
  const sub = path.join(tmp, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${path.join('..', 'repo', '.git')}\n`);
  assert.equal(await headBranch(sub), 'feat/x');

  g('checkout', '-q', '--detach');
  assert.equal(await headBranch(dir), null);
  assert.equal(await headBranch(path.join(dir, 'nulle-part')), null);
  assert.equal(await headBranch(tmp), null);
});
