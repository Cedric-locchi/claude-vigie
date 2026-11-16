// État git du dossier d'une session : fichiers modifiés par rapport à HEAD (indexés ou non, non suivis compris)
// et leur patch. Seuls restoreFile, commitAll, createBranch et replaceFile (writeWorktreeFile, files.writeProjectFile) modifient le dépôt.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // dépôt sans commit : on compare à l'arbre vide
const MAX_FILES = 200;
export const MAX_PATCH = 100_000;

/** git sans prompt ni pager ; `ok` : codes de sortie attendus (diff --no-index rend 1 quand ça diffère). */
export function git(cwd, args, ok = [0]) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotePath=false', ...args], { cwd, maxBuffer: 32e6, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout, stderr) => {
      // stderr remonté tel quel : c'est lui qui explique un hook pre-commit ou une signature en échec.
      if (err && !ok.includes(err.code)) reject(Object.assign(err, { message: (stderr || stdout).trim() || err.message }));
      else resolve(stdout);
    });
  });
}

/** `git status --porcelain=v1 -z` → fichiers ; un renommage occupe deux champs (nouveau puis ancien chemin). */
export function parseStatus(out) {
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1], file = { path: e.slice(3) };
    if (x === 'R' || x === 'C') file.from = parts[++i];
    file.status = x === '?' ? '?' : x === 'R' || y === 'R' ? 'R' : x === 'D' || y === 'D' ? 'D' : x === 'A' ? 'A' : 'M';
    file.staged = x !== ' ' && x !== '?';
    file.unstaged = y !== ' ';
    files.push(file);
  }
  return files;
}

/** Lignes ajoutées / retirées d'un patch unifié (en-têtes exclus). */
export function countLines(patch) {
  let added = 0, removed = 0;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l[0] === '+') added++;
    else if (l[0] === '-') removed++;
  }
  return { added, removed };
}

/** Chemin tel que git l'écrit : entre guillemets avec échappements C (octets en octal) dès qu'il contient un caractère de contrôle, `"` ou `\\`. */
function unquote(s) {
  if (s[0] !== '"') return s;
  const esc = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };
  const bytes = [];
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== '\\') { const ch = String.fromCodePoint(s.codePointAt(i)); bytes.push(...Buffer.from(ch)); i += ch.length - 1; continue; }
    const c = s[++i];
    if (/[0-7]/.test(c)) { bytes.push(parseInt(s.slice(i, i + 3), 8)); i += 2; } else bytes.push(esc[c] ?? c.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Sortie d'un `git diff` (préfixes a/ b/) → Map chemin → patch du fichier, découpée sur les en-têtes `diff --git`.
 * Un renommage est rangé sous son nouveau chemin (`rename to`). Sinon l'en-tête est `a/X b/X` : les deux moitiés
 * sont identiques, on coupe au milieu, ce qui tient avec des espaces dans X (impossible à découper sur l'espace).
 */
export function splitPatch(out) {
  const map = new Map();
  for (const chunk of out.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue;
    const head = chunk.slice(0, chunk.search(/^(@@|--- |Binary files )/m) >>> 0); // >>> 0 : -1 → tout le chunk
    const renamed = head.match(/^rename to (.*)$/m);
    let file = renamed && unquote(renamed[1]);
    if (!file) {
      const rest = head.slice(11, head.indexOf('\n') >>> 0);
      const a = unquote(rest.slice(0, (rest.length - 1) / 2)), b = unquote(rest.slice((rest.length + 1) / 2));
      if (a.slice(2) === b.slice(2)) file = b.slice(2);
    }
    if (file) map.set(file, chunk);
  }
  return map;
}

/** Patch « tout ajouté » d'un fichier non suivi, au format de `git diff --no-index /dev/null f`, lu sans process. */
export async function untrackedPatch(root, file) {
  const full = path.join(root, file);
  const st = await fs.promises.lstat(full);
  const link = st.isSymbolicLink();
  if (!link && !st.isFile()) return { patch: '', truncated: false }; // dépôt imbriqué, socket… : rien à montrer
  let buf;
  if (link) buf = Buffer.from(await fs.promises.readlink(full));
  else {
    // ponytail: au-delà de MAX_PATCH on ne lit que le début ; `added` compte alors les lignes lues, pas tout le fichier.
    const fh = await fs.promises.open(full, 'r');
    try { const { bytesRead, buffer } = await fh.read(Buffer.alloc(Math.min(st.size, MAX_PATCH)), 0, Math.min(st.size, MAX_PATCH), 0); buf = buffer.subarray(0, bytesRead); }
    finally { await fh.close(); }
  }
  const cut = st.size > buf.length;
  if (cut && buf.includes(10)) buf = buf.subarray(0, buf.lastIndexOf(10) + 1); // pas de caractère UTF-8 coupé en deux
  // ponytail: chemin écrit tel quel ; git le mettrait entre guillemets s'il contenait un caractère de contrôle, `"` ou `\\`.
  const tab = file.includes(' ') ? '\t' : ''; // git ajoute une tabulation après un chemin contenant un espace
  let patch = `diff --git a/${file} b/${file}\nnew file mode ${link ? '120000' : st.mode & 0o111 ? '100755' : '100644'}\n`;
  if (buf.length || cut) {
    if (buf.subarray(0, 8000).includes(0)) patch += `Binary files /dev/null and b/${file}${tab} differ\n`; // même heuristique que git
    else {
      const text = buf.toString('utf8');
      const lines = text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      patch += `--- /dev/null\n+++ b/${file}${tab}\n@@ -0,0 +1${lines.length === 1 ? '' : ',' + lines.length} @@\n`
        + lines.map((l) => '+' + l).join('\n') + (text.endsWith('\n') || cut ? '\n' : '\n\\ No newline at end of file\n');
    }
  }
  return { patch, truncated: cut || patch.length > MAX_PATCH };
}

// Cache par cwd : l'UI redemande le diff à chaque activité (~400 ms) ; on sert le même résultat 1,5 s et une requête
// en cours est partagée. Clé = cwd plutôt que racine, pour éviter aussi le `rev-parse` de chaque appel.
const TTL = 1500;
const cache = new Map(); // cwd → { at, p }
// ponytail: une modification via Vigie vide tout le cache (rare) ; par racine si plusieurs dépôts suivis en souffrent.
const invalidate = () => cache.clear();

export function readGitDiff(cwd) {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = computeGitDiff(cwd);
  cache.set(cwd, { at: Date.now(), p });
  p.catch(() => { if (cache.get(cwd)?.p === p) cache.delete(cwd); });
  return p;
}

async function computeGitDiff(cwd) {
  let root;
  try { root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim(); } catch { return { cwd, repo: false, root: null, branch: null, files: [], total: 0 }; }
  const [branch, base, status] = await Promise.all([
    git(root, ['branch', '--show-current']).then((s) => s.trim() || null, () => null),
    git(root, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => 'HEAD', () => EMPTY_TREE),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);
  const all = parseStatus(status);
  // Un seul `git diff` pour tous les fichiers suivis ; préfixes forcés et diff externe coupé, quelle que soit la config.
  // ponytail: on diffe tout le dépôt même au-delà de MAX_FILES (borné par maxBuffer) ; pathspec des MAX_FILES premiers si ça pèse.
  const patches = all.some((f) => f.status !== '?')
    ? splitPatch(await git(root, ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '-M', base]).catch(() => ''))
    : new Map();
  const files = await Promise.all(all.slice(0, MAX_FILES).map(async (f) => {
    // Renommage non détecté par -M (trop modifié) : suppression de l'ancien + ajout du nouveau, comme le diff à deux chemins d'avant.
    const { patch, truncated } = f.status === '?'
      ? await untrackedPatch(root, f.path).catch(() => ({ patch: '', truncated: false }))
      : { patch: [f.from, f.path].map((p) => (p && patches.get(p)) || '').join(''), truncated: false };
    return { ...f, ...countLines(patch), patch: patch.slice(0, MAX_PATCH), truncated: truncated || patch.length > MAX_PATCH };
  }));
  return { cwd, repo: true, root, branch, files, total: all.length };
}

/** Annule les modifications d'un fichier par rapport à HEAD. Seul un chemin présent dans `git status` est accepté. */
export async function restoreFile(cwd, filePath) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const f = parseStatus(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).find((x) => x.path === filePath);
  if (!f) throw new Error('fichier non modifié');
  try {
    if (f.status === '?') return await fs.promises.rm(path.join(root, f.path), { force: true });
    if (f.status === 'A' || f.status === 'R') await git(root, ['rm', '-f', '-q', '--', f.path]);
    if (f.status !== 'A') await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', f.from ?? f.path]);
  } finally { invalidate(); }
}

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Branche courante de `dir` lue dans `.git/HEAD`, sans lancer git (le sélecteur de projet l'appelle pour des dizaines de dossiers).
 * `.git` fichier (worktree, sous-module) : `gitdir: X`, X relatif à `dir` ou absolu. HEAD détachée, absente, illisible → null ; ne lève jamais.
 */
export async function headBranch(dir) {
  // ponytail: seul `dir` lui-même est examiné, pas ses parents ; un sous-dossier d'un dépôt rend null (remonter comme git si le sélecteur en a besoin).
  try {
    const dotGit = path.join(dir, '.git');
    let gitDir = dotGit;
    if ((await fs.promises.stat(dotGit)).isFile()) {
      const m = (await fs.promises.readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+?)\s*$/m);
      if (!m) return null;
      gitDir = path.resolve(dir, m[1]);
    }
    const m = (await fs.promises.readFile(path.join(gitDir, 'HEAD'), 'utf8')).match(/^ref:\s*refs\/heads\/(.+?)\s*$/m);
    return m && m[1] !== '.invalid' ? m[1] : null;
  } catch { return null; }
}

/** Racine du dépôt contenant `cwd`, ou null hors dépôt. */
export async function repoRoot(cwd) {
  try { return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim(); } catch { return null; }
}

/**
 * Garde commune à toute lecture ou écriture d'un fichier de l'utilisateur : fichier ordinaire (ni lien, ni dossier,
 * ni sous-module), réellement sous `root`, texte UTF-8 et de taille raisonnable. `rel` : chemin relatif à `root`.
 */
export async function checkFile(root, rel) {
  const full = path.join(root, rel);
  const st = await fs.promises.lstat(full).catch(() => null);
  if (!st?.isFile()) throw fail('pas un fichier ordinaire');
  // Un dossier parent lien symbolique ferait sortir du dépôt malgré le lstat du fichier lui-même.
  const out = path.relative(await fs.promises.realpath(root), await fs.promises.realpath(full));
  if (out === '..' || out.startsWith('..' + path.sep) || path.isAbsolute(out)) throw fail('fichier hors du dépôt');
  if (st.size > MAX_PATCH) throw fail('fichier trop volumineux pour être édité');
  const buf = await fs.promises.readFile(full);
  if (buf.subarray(0, 8000).includes(0)) throw fail('fichier binaire'); // même heuristique que untrackedPatch
  let content;
  // ignoreBOM : le BOM reste dans le texte, donc réécrit à l'identique.
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf); } catch { throw fail('fichier non UTF-8'); }
  return { full, st, buf, content };
}

/** Garde de l'onglet Diff : `checkFile`, et seulement pour un chemin présent dans `git status` et pas supprimé. */
async function editable(cwd, filePath) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const f = parseStatus(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).find((x) => x.path === filePath);
  if (!f) throw fail('fichier non modifié');
  if (f.status === 'D') throw fail('fichier supprimé');
  return { root, ...(await checkFile(root, f.path)) };
}

/** Contenu d'un fichier modifié et l'empreinte (sha256 des octets sur disque) à renvoyer avec l'écriture. */
export async function readWorktreeFile(cwd, filePath) {
  const { content, buf } = await editable(cwd, filePath);
  return { path: filePath, content, hash: sha256(buf) };
}

/** Vrai si `full` (déjà résolu) est sous `<home>/.claude` résolu : la config Claude n'est jamais écrite par Vigie. */
async function underClaudeConfig(full, home) {
  const dir = path.join(home, '.claude');
  const real = await fs.promises.realpath(dir).catch(() => path.resolve(dir));
  const rel = path.relative(real, await fs.promises.realpath(full));
  return !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}

/**
 * Remplace le fichier rendu par `check()` (garde rejouée juste avant le rename) par `content`, seulement s'il n'a pas
 * changé depuis la lecture (`hash`, sinon 412) et s'il n'est pas sous `<home>/.claude` (403).
 * Écriture atomique : fichier temporaire dans le même dossier puis rename, mode d'origine conservé.
 */
export async function replaceFile(check, content, hash, home) {
  const data = Buffer.from(content, 'utf8');
  if (data.length > MAX_PATCH) throw fail('contenu trop volumineux');
  const { full, st, buf } = await check();
  if (await underClaudeConfig(full, home)) throw fail('config Claude en lecture seule', 403);
  if (sha256(buf) !== hash) throw fail('Fichier modifié entre-temps', 412);
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.vigie-${process.pid}-${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(tmp, data, { flag: 'wx', mode: 0o600 });
    await fs.promises.chmod(tmp, st.mode & 0o7777);
    // ponytail: fenêtre de course entre cette vérification et le rename (quelques ms) ; un verrou n'existe pas côté Claude, on s'en tient là.
    if (sha256((await check()).buf) !== hash) throw fail('Fichier modifié entre-temps', 412);
    // ponytail: rename = nouvel inode ; un lien physique vers ce fichier garde l'ancien contenu (propriétaire et xattrs non recopiés). Écrire en place si ça gêne.
    await fs.promises.rename(tmp, full);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  } finally { invalidate(); }
}

/** Remplace un fichier modifié (onglet Diff) : garde `editable`, puis `replaceFile`. `home` : dossier dont `.claude` est protégé. */
export function writeWorktreeFile(cwd, filePath, content, hash, home = os.homedir()) {
  return replaceFile(() => editable(cwd, filePath), content, hash, home);
}

/** Indexe tout (.gitignore respecté) et commite avec `message`. */
export async function commitAll(cwd, message) {
  if (!message.trim()) throw new Error('message de commit vide');
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  try {
    await git(root, ['add', '-A']);
    await git(root, ['commit', '-q', '-m', message]);
  } finally { invalidate(); }
}

/** Crée la branche `name` depuis HEAD et bascule dessus ; les modifs non commitées suivent (git switch -c). */
export async function createBranch(cwd, name) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  await git(root, ['check-ref-format', '--branch', name]);
  try { await git(root, ['switch', '-c', name]); } finally { invalidate(); }
}

const MAX_PROMPT_DIFF = 60_000;

/** Message de commit proposé par `claude -p` (sans outils ni transcript) à partir du diff et du style des derniers commits. */
export async function suggestCommitMessage(cwd, env) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const base = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => 'HEAD', () => EMPTY_TREE);
  const [diff, untracked, log] = await Promise.all([
    git(root, ['diff', '--no-color', '-M', base]),
    git(root, ['ls-files', '--others', '--exclude-standard']),
    git(root, ['log', '-15', '--format=%s']).catch(() => ''),
  ]);
  if (!diff.trim() && !untracked.trim()) throw new Error('rien à commiter');
  const prompt = [
    'Rédige le message de commit git pour les changements ci-dessous.',
    'Respecte la langue et la convention des commits récents (ex. Conventional Commits si utilisée). Ligne de titre ≤ 72 caractères, puis, si utile, une ligne vide et un corps court expliquant le pourquoi.',
    'Réponds uniquement avec le message, sans bloc de code ni commentaire.',
    `\n## Commits récents\n${log || '(aucun)'}`,
    `\n## Fichiers non suivis\n${untracked || '(aucun)'}`,
    `\n## Diff\n${diff.slice(0, MAX_PROMPT_DIFF)}${diff.length > MAX_PROMPT_DIFF ? '\n[… diff tronqué]' : ''}`,
  ].join('\n');
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--no-session-persistence', '--tools', '', '--model', 'haiku'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `claude a quitté avec le code ${code}`))));
    p.stdin.end(prompt);
  });
}
