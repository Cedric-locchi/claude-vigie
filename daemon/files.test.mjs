import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listProjectFiles, readProjectFile, searchProjectFiles, writeProjectFile } from './files.mjs';
import { readGitDiff } from './git.mjs';
import { FileBody, ProjectFiles, SearchResults } from '../contract/index.mjs';

const conforme = (S, v) => { const j = JSON.parse(JSON.stringify(v)); assert.deepStrictEqual(S.parse(j), j); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (dir, rel, data = 'v1\n') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), data); };

/** Dépôt : suivi.txt commité, non-suivi.txt, .env et dist/ ignorés, sous/ ; .env factice, jamais un vrai. */
function repo() {
  const dir = fs.realpathSync(tmp('vigie-files-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
  g('init', '-q');
  put(dir, '.gitignore', '.env\ndist/\n');
  put(dir, 'suivi.txt');
  put(dir, 'sous/b.txt');
  g('add', '.'); g('commit', '-qm', 'init');
  put(dir, 'non-suivi.txt');
  put(dir, '.env', 'FAUX=1\n');
  put(dir, 'dist/app.js');
  return dir;
}

test('listProjectFiles (git) : suivis, non suivis, ignorés ; dossier ignoré replié ; pas de .git ; relatif à la racine', async () => {
  const dir = repo();
  const l = await listProjectFiles(path.join(dir, 'sous'));
  conforme(ProjectFiles, l);
  assert.deepEqual([l.root, l.repo, l.truncated], [dir, true, false]);
  assert.deepEqual(l.files.sort(), ['.env', '.gitignore', 'non-suivi.txt', 'sous/b.txt', 'suivi.txt']);
  assert.deepEqual(l.collapsed, ['dist']);
});

test('listProjectFiles (hors git) : node_modules replié, dossier caché parcouru, lien exclu, coupe', async () => {
  const dir = fs.realpathSync(tmp('vigie-nogit-'));
  put(dir, 'a.txt'); put(dir, '.cache/c.txt'); put(dir, 'node_modules/x/i.js'); put(dir, 'd/e/f.txt');
  fs.symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'lien.txt'));
  fs.symlinkSync(path.join(dir, 'd'), path.join(dir, 'lien-dossier'));
  const l = await listProjectFiles(dir);
  conforme(ProjectFiles, l);
  assert.deepEqual([l.root, l.repo, l.truncated], [dir, false, false]);
  assert.deepEqual(l.files.sort(), ['.cache/c.txt', 'a.txt', 'd/e/f.txt']);
  assert.deepEqual(l.collapsed, ['node_modules']);
  const cut = await listProjectFiles(dir, 3);
  assert.equal(cut.truncated, true);
  assert.equal(cut.files.length + cut.collapsed.length, 3);
});

test('readProjectFile : suivi non modifié, ignoré, hors git ; empreinte = sha256', async () => {
  const dir = repo();
  for (const [p, content] of [['suivi.txt', 'v1\n'], ['.env', 'FAUX=1\n'], ['dist/app.js', 'v1\n']]) {
    const f = await readProjectFile(dir, p);
    conforme(FileBody, f);
    assert.deepEqual(f, { path: p, content, hash: sha(Buffer.from(content)) });
  }
  const nogit = tmp('vigie-nogit-');
  put(nogit, 'x/y.txt', 'ok\n');
  assert.equal((await readProjectFile(nogit, 'x/y.txt')).content, 'ok\n');
});

test('readProjectFile : refuse .git, sortie, absolu, dossier, liens sortants, binaire, trop gros, non UTF-8', async () => {
  const dir = repo();
  const outside = tmp('vigie-out-');
  put(outside, 'secret.txt', 'secret\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'lien.txt'));
  fs.symlinkSync(outside, path.join(dir, 'lien-dossier'));
  put(dir, 'bin.dat', Buffer.from([1, 0, 2]));
  put(dir, 'gros.txt', 'x'.repeat(100_001));
  put(dir, 'latin.txt', Buffer.from([0xff]));
  for (const [p, re] of [['.git/config', /\.git/], ['sous/../.GIT/HEAD', /\.git/], ['../x', /hors du projet/], ['sous/../../x', /hors du projet/],
    [path.join(outside, 'secret.txt'), /invalide/], ['a\0b', /invalide/], ['sous', /ordinaire/], ['absent.txt', /ordinaire/],
    ['lien.txt', /ordinaire/], ['lien-dossier/secret.txt', /hors du dépôt/], ['bin.dat', /binaire/], ['gros.txt', /volumineux/], ['latin.txt', /UTF-8/]]) {
    await assert.rejects(readProjectFile(dir, p), (e) => re.test(e.message) && e.status === 400, p);
  }
});

test('writeProjectFile : fichier non modifié écrit, 412 laisse intact, 403 sous ~/.claude, cache du diff invalidé', async () => {
  const dir = repo();
  const home = tmp('vigie-home-');
  const before = await readGitDiff(dir);
  const { hash } = await readProjectFile(dir, 'suivi.txt');
  await writeProjectFile(dir, 'suivi.txt', 'v2\n', hash, home);
  assert.equal(fs.readFileSync(path.join(dir, 'suivi.txt'), 'utf8'), 'v2\n');
  const after = await readGitDiff(dir);
  assert.notEqual(after, before);
  assert.ok(after.files.some((f) => f.path === 'suivi.txt'));

  await assert.rejects(writeProjectFile(dir, 'suivi.txt', 'v3\n', hash, home), (e) => e.status === 412);
  assert.equal(fs.readFileSync(path.join(dir, 'suivi.txt'), 'utf8'), 'v2\n');

  // Projet = ~/.claude lui-même (ou un dossier qui y mène par lien) : lecture permise, écriture refusée.
  put(home, '.claude/settings.json', '{}\n');
  const f = await readProjectFile(path.join(home, '.claude'), 'settings.json');
  await assert.rejects(writeProjectFile(path.join(home, '.claude'), 'settings.json', '{"x":1}\n', f.hash, home), (e) => e.status === 403 && /lecture seule/.test(e.message));
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{}\n');
});

const paths = (r) => r.files.map((f) => f.path).sort();

test('searchProjectFiles (git) : conforme ; ignorés (.env, dist/) jamais lus ; chemins relatifs à la racine', async () => {
  const dir = repo();
  put(dir, 'sous/c.txt', 'rien\nun v1 ici\n');
  const r = await searchProjectFiles(path.join(dir, 'sous'), 'v1');
  conforme(SearchResults, r);
  assert.equal(r.truncated, false);
  assert.deepEqual(paths(r), ['non-suivi.txt', 'sous/b.txt', 'sous/c.txt', 'suivi.txt']);
  assert.deepEqual(r.files.find((f) => f.path === 'sous/c.txt').matches, [{ line: 2, col: 4, text: 'un v1 ici', at: 3 }]);
  assert.deepEqual((await searchProjectFiles(dir, 'FAUX')).files, []);
});

test('searchProjectFiles (hors git) : conforme ; node_modules et lien sautés', async () => {
  const dir = fs.realpathSync(tmp('vigie-search-'));
  put(dir, 'a.txt', 'aiguille\n'); put(dir, 'node_modules/x/i.js', 'aiguille\n');
  fs.symlinkSync(path.join(dir, 'a.txt'), path.join(dir, 'lien.txt'));
  const r = await searchProjectFiles(dir, 'aiguille');
  conforme(SearchResults, r);
  assert.deepEqual(paths(r), ['a.txt']);
});

test('searchProjectFiles : casse, texte littéral, CRLF, extrait d’une ligne longue', async () => {
  const dir = fs.realpathSync(tmp('vigie-search-'));
  put(dir, 'casse.txt', 'Bonjour\n');
  put(dir, 'lit.txt', 'axb\nf(x)\n');
  put(dir, 'crlf.txt', 'un\r\ndeux\r\n  trois\r\n');
  const long = 'é'.repeat(500) + 'CIBLE' + 'z'.repeat(500);
  put(dir, 'long.txt', long);
  assert.deepEqual(paths(await searchProjectFiles(dir, 'bonjour')), ['casse.txt']);
  assert.deepEqual(paths(await searchProjectFiles(dir, 'bonjour', { matchCase: true })), []);
  assert.deepEqual(paths(await searchProjectFiles(dir, 'Bonjour', { matchCase: true })), ['casse.txt']);
  assert.deepEqual(paths(await searchProjectFiles(dir, 'a.b')), []);
  assert.deepEqual((await searchProjectFiles(dir, 'f(')).files[0].matches, [{ line: 2, col: 1, text: 'f(x)', at: 0 }]);
  assert.deepEqual((await searchProjectFiles(dir, 'trois')).files[0].matches, [{ line: 3, col: 3, text: '  trois', at: 2 }]);
  const [m] = (await searchProjectFiles(dir, 'cible')).files[0].matches;
  assert.equal(m.col, 501);
  assert.ok(m.text.length <= 200);
  assert.equal(m.text.slice(m.at, m.at + 5), 'CIBLE');
});

test('searchProjectFiles : binaire, > 100 Ko, non UTF-8 sautés ; plafond ; signal annulé', async () => {
  const dir = fs.realpathSync(tmp('vigie-search-'));
  put(dir, 'bin.dat', Buffer.from('mot\0mot'));
  put(dir, 'gros.txt', 'mot\n'.repeat(30_000));
  put(dir, 'latin1.txt', Buffer.from('mot \xe9t\xe9\n', 'latin1'));
  put(dir, 'ok.txt', 'mot\nmot\nmot\nmot\nmot\n');
  const r = await searchProjectFiles(dir, 'mot');
  assert.deepEqual(paths(r), ['ok.txt']);
  assert.equal(r.files[0].matches.length, 5);
  const cut = await searchProjectFiles(dir, 'mot', { max: 3 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.files.flatMap((f) => f.matches).length, 3);
  assert.deepEqual((await searchProjectFiles(dir, 'mot', { signal: AbortSignal.abort() })).files, []);
});

test('searchProjectFiles : dossier parent devenu lien vers l’extérieur sauté ; BOM gardé comme /files/read', async () => {
  const dir = repo();
  put(dir, 'a/b.txt', 'rien\n');
  execFileSync('git', ['add', 'a/b.txt'], { cwd: dir });
  const outside = fs.realpathSync(tmp('vigie-dehors-'));
  put(outside, 'b.txt', 'aiguille\n');
  fs.rmSync(path.join(dir, 'a'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, 'a'));
  assert.deepEqual((await searchProjectFiles(dir, 'aiguille')).files, []);

  put(dir, 'bom.txt', '\uFEFFcible\n');
  const [m] = (await searchProjectFiles(dir, 'cible')).files.find((f) => f.path === 'bom.txt').matches;
  const { content } = await readProjectFile(dir, 'bom.txt');
  assert.equal(m.col, 2);
  assert.equal(content.split('\n')[0].slice(m.col - 1, m.col + 4), 'cible');
});
