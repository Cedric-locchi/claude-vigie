import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_ARGS, commitAll, createBranch, diffCacheSize, headBranch, killAll, parseStatus, readGitDiff, readWorktreeFile, restoreFile, splitPatch, suggestCommitMessage, underClaudeConfig, untrackedPatch, writeWorktreeFile } from './git.mjs';
import { CommitSuggestion, FileBody, GitDiff } from '../contract/index.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

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
  const dir = tempDir('vigie-git-');
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

  const none = await readGitDiff(tempDir('vigie-nogit-'));
  conforme(GitDiff, none);
  assert.equal(none.repo, false);
});

test('restoreFile : modifié, ajouté, non suivi ; refuse un chemin hors status', async () => {
  const dir = tempDir('vigie-git-');
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
  const dir = tempDir('vigie-git-');
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
  const dir = tempDir('vigie-git-');
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
  const dir = tempDir('vigie-git-');
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

test('readGitDiff : cache borné, les entrées expirées (1,5 s) sont retirées au calcul suivant', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const [a, b] = [tempDir('vigie-git-'), tempDir('vigie-git-')];
  await readGitDiff(a);
  await readGitDiff(b);
  assert.ok(diffCacheSize() >= 2);
  t.mock.timers.tick(1500);
  await readGitDiff(b); // b expirée : recalculée, a retirée au passage
  assert.equal(diffCacheSize(), 1);
});

test('readGitDiff : diff externe coupé (format de splitPatch), textconv gardé (git-crypt lisible, comme dans un terminal)', async () => {
  const { dir, g } = repo();
  const bin = tempDir('vigie-bin-');
  fs.writeFileSync(path.join(bin, 'externe'), '#!/bin/sh\necho EXTERNE\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'conv'), '#!/bin/sh\ntr a-z A-Z < "$1"\n', { mode: 0o755 });
  g('config', 'diff.external', path.join(bin, 'externe'));
  g('config', 'diff.conv.textconv', path.join(bin, 'conv'));
  fs.writeFileSync(path.join(dir, '.git', 'info', 'attributes'), '*.txt diff=conv\n');
  const patch = (await readGitDiff(dir)).files.find((f) => f.path === 'a.txt').patch;
  assert.ok(patch.includes('\n-V1\n+V2\n'), patch);
  assert.ok(!patch.includes('EXTERNE'), patch);
});

test('untrackedPatch : fichier trop gros tronqué, vide sans hunk', async () => {
  const dir = tempDir('vigie-git-');
  fs.writeFileSync(path.join(dir, 'gros.txt'), 'abcdefghi\n'.repeat(20_000));
  const big = await untrackedPatch(dir, 'gros.txt');
  assert.equal(big.truncated, true);
  assert.ok(big.patch.length > 90_000);
  fs.writeFileSync(path.join(dir, 'vide'), '');
  assert.deepEqual(await untrackedPatch(dir, 'vide'), { patch: 'diff --git a/vide b/vide\nnew file mode 100644\n', truncated: false });
});

test('untrackedPatch : au-delà de MAX_PATCH, added compte tout le fichier', async () => {
  const dir = tempDir('vigie-git-');
  fs.writeFileSync(path.join(dir, 'gros.txt'), 'abcdefghi\n'.repeat(20_000));
  fs.writeFileSync(path.join(dir, 'sans-fin.txt'), 'abcdefghi\n'.repeat(20_000) + 'fin');
  assert.equal((await untrackedPatch(dir, 'gros.txt')).added, 20_000);
  assert.equal((await untrackedPatch(dir, 'sans-fin.txt')).added, 20_001);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  assert.equal((await readGitDiff(dir)).files.find((f) => f.path === 'gros.txt').added, 20_000);
});

test('untrackedPatch : chemin avec guillemet, antislash, contrôle mis entre guillemets comme git', async () => {
  const dir = tempDir('vigie-git-');
  const names = ['a"b\\c\nd e.txt', 'b\x01in\tx y'];
  fs.writeFileSync(path.join(dir, names[0]), 'x\n+faux\n');
  fs.writeFileSync(path.join(dir, names[1]), Buffer.from([0, 1]));
  for (const f of names) {
    let ref;
    try { execFileSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: dir }); } catch (e) { ref = e.stdout.toString(); }
    assert.equal((await untrackedPatch(dir, f)).patch, ref.replace(/^index .*\n/m, ''), JSON.stringify(f));
  }
});

/** Dépôt avec a.txt commité puis modifié ; renvoie le dossier et un raccourci git. */
function repo() {
  const dir = tempDir('vigie-edit-');
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
  const outside = path.join(tempDir('vigie-out-'), 'secret.txt');
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

test('writeWorktreeFile : lien physique écrit en place (même inode, l’autre nom suit) ; lecture seule refusée (403)', async () => {
  const { dir } = repo();
  const file = (p) => path.join(dir, p);
  fs.linkSync(file('a.txt'), file('jumeau.txt'));
  const ino = fs.statSync(file('a.txt')).ino;
  let { hash } = await readWorktreeFile(dir, 'a.txt');
  await writeWorktreeFile(dir, 'a.txt', 'v3\n', hash);
  assert.equal(fs.statSync(file('a.txt')).ino, ino);
  assert.equal(fs.readFileSync(file('jumeau.txt'), 'utf8'), 'v3\n');
  ({ hash } = await readWorktreeFile(dir, 'a.txt'));
  await writeWorktreeFile(dir, 'a.txt', 'v', hash); // plus court : la fin ancienne est coupée
  assert.equal(fs.readFileSync(file('jumeau.txt'), 'utf8'), 'v');
  fs.writeFileSync(file('jumeau.txt'), 'changé par Claude\n');
  await assert.rejects(writeWorktreeFile(dir, 'a.txt', 'écrasé', hash), (e) => e.status === 412);
  assert.equal(fs.readFileSync(file('a.txt'), 'utf8'), 'changé par Claude\n');

  if (process.getuid() === 0) return; // root écrit partout : le contrôle de droit ne s'applique pas
  fs.writeFileSync(file('run.sh'), 'protégé\n'); fs.chmodSync(file('run.sh'), 0o444);
  ({ hash } = await readWorktreeFile(dir, 'run.sh'));
  await assert.rejects(writeWorktreeFile(dir, 'run.sh', 'écrasé', hash), (e) => e.status === 403 && /lecture seule/.test(e.message));
  assert.equal(fs.readFileSync(file('run.sh'), 'utf8'), 'protégé\n');
});

test('writeWorktreeFile : refuse d’écrire sous <home>/.claude (403), lien compris', async () => {
  const { dir } = repo();
  const home = tempDir('vigie-home-');
  fs.symlinkSync(dir, path.join(home, '.claude')); // ~/.claude qui mène au dépôt : la cible résolue est protégée
  const { hash } = await readWorktreeFile(dir, 'a.txt');
  await assert.rejects(writeWorktreeFile(dir, 'a.txt', 'pirate\n', hash, home), (e) => e.status === 403 && /lecture seule/.test(e.message));
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v2\n');
  await writeWorktreeFile(dir, 'a.txt', 'v3\n', hash, tempDir('vigie-home-'));
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v3\n');
});

test('restoreFile : refuse d’effacer ou de restaurer dans la config Claude (403), lien compris ; rien n’est touché', async () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, 'neuf.txt'), 'n\n');
  const home = tempDir('vigie-home-');
  fs.symlinkSync(dir, path.join(home, '.claude')); // ~/.claude qui mène au dépôt
  for (const p of ['a.txt', 'neuf.txt']) await assert.rejects(restoreFile(dir, p, home), (e) => e.status === 403 && /lecture seule/.test(e.message), p);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v2\n');
  assert.ok(fs.existsSync(path.join(dir, 'neuf.txt')));
  await restoreFile(dir, 'a.txt', tempDir('vigie-home-'));
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1\n');
});

test('underClaudeConfig : ~/.claude, ~/.claude.json (lien suivi), CLAUDE_CONFIG_DIR ; fichier supprimé jugé par son dossier', async () => {
  const { dir } = repo();
  const file = path.join(dir, 'a.txt');
  const home = tempDir('vigie-home-');
  assert.equal(await underClaudeConfig(file, home, {}), false);
  fs.symlinkSync(file, path.join(home, '.claude.json'));
  assert.equal(await underClaudeConfig(file, home, {}), true);
  const other = tempDir('vigie-home-');
  assert.equal(await underClaudeConfig(file, other, { CLAUDE_CONFIG_DIR: dir }), true);
  assert.equal(await underClaudeConfig(path.join(dir, 'disparu.txt'), other, { CLAUDE_CONFIG_DIR: dir }), true);
  assert.equal(await underClaudeConfig(file, other, { CLAUDE_CONFIG_DIR: path.join(other, 'cfg') }), false);
});

test('suggestCommitMessage : réponse de claude conforme ; lancé hors du dépôt, sans réglages ni MCP ; abandon et délai tuent claude et ses enfants', async () => {
  const { dir } = repo();
  const bin = tempDir('vigie-bin-');
  const workDir = path.join(tempDir('vigie-home-'), '.vigie', 'commit-message'); // créé au premier appel
  const fake = (body) => { fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\n${body}\n`, { mode: 0o755 }); };
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  fake('cat >/dev/null; echo "fix: corrige a"');
  const message = await suggestCommitMessage(dir, env, { workDir });
  assert.equal(message, 'fix: corrige a');
  conforme(CommitSuggestion, { message });
  // Dossier vide de Vigie (pas le dépôt : ni son CLAUDE.md, ni ses hooks), arguments exacts de la décision 046.
  fake('cat >/dev/null; printf "%s|" "$(pwd -P)" "$@"');
  assert.equal(await suggestCommitMessage(dir, env, { workDir }), [workDir, ...CLAUDE_ARGS].join('|') + '|');
  assert.deepEqual(CLAUDE_ARGS, ['-p', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--model', 'haiku']);
  assert.deepEqual(fs.readdirSync(workDir), []);
  fake('exec sleep 30');
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const t0 = Date.now();
  await assert.rejects(suggestCommitMessage(dir, env, { workDir, signal: ac.signal }), (e) => e.name === 'AbortError');
  // Un enfant de claude (hook, serveur) est arrêté avec lui : groupe de processus tué au délai.
  const pidFile = path.join(bin, 'enfant.pid');
  fake(`sleep 30 & echo $! > ${pidFile}; exec sleep 30`);
  await assert.rejects(suggestCommitMessage(dir, env, { workDir, timeout: 200 }), /ne répond pas/);
  const child = Number(fs.readFileSync(pidFile, 'utf8'));
  const alive = () => { try { process.kill(child, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(), false);
  assert.ok(Date.now() - t0 < 10_000);
  await assert.rejects(suggestCommitMessage(dir, env, {}), TypeError); // sans workDir : rien n'est lancé
});

test('suggestCommitMessage : prompt borné (200 noms non suivis, diff tronqué sans échec), ni diff externe ni textconv', async () => {
  const { dir, g } = repo();
  const bin = tempDir('vigie-bin-');
  const workDir = path.join(tempDir('vigie-home-'), 'commit-message');
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  script('claude', 'cat'); // rend le prompt tel quel
  script('externe', 'echo EXTERNE');
  script('conv', 'echo TEXTCONV');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  // Config du dépôt qui ferait passer autre chose que le patch dans le prompt (git-crypt déchiffre par textconv).
  g('config', 'diff.external', path.join(bin, 'externe'));
  g('config', 'diff.conv.textconv', path.join(bin, 'conv'));
  fs.writeFileSync(path.join(dir, '.gitattributes'), '*.txt diff=conv\n');
  g('add', '.gitattributes'); g('commit', '-qm', 'attributs');
  for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(dir, `n${String(i).padStart(3, '0')}.txt`), '');
  fs.writeFileSync(path.join(dir, 'gros.txt'), 'x\n'.repeat(150_000)); // diff de 300 Ko : au-delà de ce que lit le prompt
  const prompt = await suggestCommitMessage(dir, env, { workDir });
  assert.ok(prompt.includes('\nn199.txt\n[… 50 autres]\n'));
  assert.ok(!prompt.includes('n200.txt'));
  assert.ok(prompt.includes('\n-v1\n+v2\n'));
  assert.ok(prompt.endsWith('[… diff tronqué]'));
  assert.ok(prompt.length < 90_000, String(prompt.length));
  assert.ok(!/EXTERNE|TEXTCONV/.test(prompt));
});

test('suggestCommitMessage : des avertissements sur stderr (CRLF) n’avancent pas la coupure du diff, la mention suit la troncature', async () => {
  const { dir, g } = repo();
  const bin = tempDir('vigie-bin-');
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\ncat\n', { mode: 0o755 }); // rend le prompt
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  // 2 000 fichiers inchangés mais à relire (date changée) : un avertissement CRLF chacun sur stderr (~200 Ko), aucun diff.
  for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(dir, `crlf-${String(i).padStart(4, '0')}.txt`), 'a\n');
  g('add', '.'); g('commit', '-qm', 'crlf');
  g('config', 'core.autocrlf', 'true');
  const later = new Date(Date.now() + 60_000);
  for (let i = 0; i < 2000; i++) fs.utimesSync(path.join(dir, `crlf-${String(i).padStart(4, '0')}.txt`), later, later);
  fs.writeFileSync(path.join(dir, 'gros.txt'), 'x\n'.repeat(50_000)); // diff de ~150 Ko : sous la lecture bornée, au-delà de MAX_PROMPT_DIFF
  const prompt = await suggestCommitMessage(dir, env, { workDir: path.join(bin, 'w') });
  const diff = prompt.slice(prompt.indexOf('\n## Diff\n') + 9);
  assert.ok(diff.endsWith('\n[… diff tronqué]'));
  assert.equal(diff.length, 60_000 + '\n[… diff tronqué]'.length);
});

test('killAll : arrête claude -p et ses enfants encore vivants (SIGTERM au groupe)', async () => {
  const { dir } = repo();
  const bin = tempDir('vigie-bin-');
  const pidFile = path.join(bin, 'enfant.pid');
  // pid écrit puis renommé : jamais lu à moitié écrit.
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nsleep 30 & echo $! > ${pidFile}.tmp && mv ${pidFile}.tmp ${pidFile}\nexec sleep 30\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const t0 = Date.now();
  const running = suggestCommitMessage(dir, env, { workDir: path.join(bin, 'w'), timeout: 30_000 });
  while (!fs.existsSync(pidFile)) await new Promise((r) => setTimeout(r, 20));
  killAll();
  await assert.rejects(running, /SIGTERM/);
  assert.ok(Date.now() - t0 < 10_000, 'groupe non tué par killAll');
  const child = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(child > 0);
  const alive = () => { try { process.kill(child, 0); return true; } catch { return false; } };
  for (let i = 0; i < 50 && alive(); i++) await new Promise((r) => setTimeout(r, 20));
  if (alive()) process.kill(child, 'SIGKILL');
  assert.equal(alive(), false, 'enfant encore vivant après killAll');
  killAll(); // plus rien à tuer : sans effet
});

test('commitAll, createBranch : refusés (403) dans un dépôt de la config Claude, worktree lié compris ; rien n’est écrit', async () => {
  const { dir, g } = repo();
  const home = tempDir('vigie-home-');
  fs.symlinkSync(dir, path.join(home, '.claude')); // ~/.claude versionné, qui mène au dépôt
  const head = () => g('rev-parse', 'HEAD').toString();
  const before = head();
  const denied = (e) => e.status === 403 && /lecture seule/.test(e.message);
  await assert.rejects(commitAll(dir, 'feat: x', home), denied);
  await assert.rejects(createBranch(dir, 'feat/x', home), denied);
  // Worktree hors de ~/.claude : son commit écrirait les objets et les refs dans le .git commun, sous ~/.claude.
  const wt = path.join(tempDir('vigie-wt-'), 'w');
  g('worktree', 'add', '-q', wt);
  await assert.rejects(commitAll(wt, 'feat: x', home), denied);
  await assert.rejects(createBranch(wt, 'feat/y', home), denied);
  assert.equal(head(), before);
  assert.equal(g('branch', '--list', 'feat/*').toString(), '');
  // Hors de la config : la même branche passe.
  await createBranch(dir, 'feat/x', tempDir('vigie-home-'));
  assert.equal((await readGitDiff(dir)).branch, 'feat/x');
});

test('headBranch : branche nommée, HEAD détachée, .git fichier relatif, worktree réel, hors dépôt', async () => {
  const tmp = tempDir('vigie-head-');
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
