// Plugin npm (décision 037) : onglet « Scripts npm » d'une session, scripts de la racine et des workspaces lancés dans un terminal.
// Lecture sans aucun process : package.json, lockfiles et pnpm-workspace.yaml seulement (jamais npm, jamais npx, jamais d'installation).
// Le gestionnaire est celui du dépôt : `packageManager`, sinon le lockfile (remonté jusqu'au dossier qui contient .git).
// Effet assumé au clic : `pnpm run` (verifyDepsBeforeRun) ou corepack peuvent installer ou télécharger dans le terminal.
// N'importe rien de Vigie : le SDK arrive en argument (`vigie`), les schémas partagés avec le front sont dans ./contract.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { NpmProject, NpmRunParams } from './contract.mjs';

const MAX_JSON = 1024 * 1024; // package.json, pnpm-workspace.yaml
const MAX_WORKSPACES = 200;
const MAX_MATCHES = 2000; // fichiers parcourus par le glob avant tri
const MAX_COMMAND = 2000;
const MAX_TEXT = 3 * 1024 * 1024; // noms + commandes en octets de JSON : la réponse reste sous les 4 Mo du runner
const MAX_LEVELS = 10;
// Nom de workspace : finit en argument (`--filter w`, `workspace w`) ; ni `-` ni `.` en tête (option, filtre pnpm par chemin),
// ni `..`, ni caractère hors des noms npm (les filtres pnpm `...`, `!`, `{}`, `^` sont donc impossibles).
const NAME = /^(?![-.])(?!.*\.\.)[\w@./~-]{1,200}$/;
// Script : nom libre, mais ni `-` en tête (option), ni antislash (refusé par vigie.terminal), ni caractère de contrôle.
// eslint-disable-next-line no-control-regex -- refuser les caractères de contrôle est le but
const SCRIPT = /^(?!-)[^\x00-\x1f\x7f\\]{1,200}$/;

// Ordre = priorité quand plusieurs gestionnaires laissent une trace.
const LOCKS = [
  ['pnpm-lock.yaml', 'pnpm'], ['pnpm-workspace.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
];
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// ── Fonctions pures ─────────────────────────────────────────────────────

/**
 * Gestionnaire d'un dossier d'après son package.json et les noms qu'il contient : `{ pm, from, warning }`, null sans aucune trace.
 * `packageManager` l'emporte ; sinon le lockfile le plus prioritaire. Désaccord ou plusieurs gestionnaires : `warning`.
 */
export function detectManager(pkg, names) {
  const set = new Set(names);
  const locks = LOCKS.filter(([n]) => set.has(n));
  const field = typeof pkg?.packageManager === 'string' ? pkg.packageManager : null;
  const declared = field?.match(/^(npm|pnpm|yarn|bun)@/)?.[1] ?? null;
  if (declared) {
    const other = locks.filter(([, pm]) => pm !== declared).map(([n]) => n);
    return { pm: declared, from: 'packageManager', warning: other.length ? `packageManager (${declared}) en désaccord avec ${other.join(', ')}` : null };
  }
  const unknown = field ? `packageManager « ${cut(field, 100)} » non reconnu` : null;
  if (!locks.length) return unknown ? { pm: 'npm', from: 'par défaut', warning: unknown } : null;
  const pms = [...new Set(locks.map(([, pm]) => pm))];
  const several = pms.length > 1 ? `Plusieurs gestionnaires (${locks.map(([n]) => n).join(', ')}) : ${pms[0]} retenu` : null;
  return { pm: pms[0], from: locks[0][0], warning: [unknown, several].filter(Boolean).join(' ; ') || null };
}

/** Motifs `packages` de pnpm-workspace.yaml : liste en bloc (`- 'a'`) ou en ligne (`['a', "b"]`) ; commentaires ignorés. */
export function parsePnpmWorkspace(text) {
  // ponytail: mini-parseur, pas de YAML complet (liste en ligne sur plusieurs lignes, ancres) ; un vrai parseur si un dépôt en a besoin.
  const lines = String(text).split(/\r?\n/);
  const i = lines.findIndex((l) => /^packages\s*:/.test(l));
  if (i < 0) return [];
  const unquote = (s) => s.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  const inline = lines[i].replace(/^packages\s*:/, '').replace(/\s+#.*$/, '').trim();
  if (inline.startsWith('[')) return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const m = l.match(/^\s*-\s*(.*)$/);
    if (!m) break;
    const v = unquote(m[1]);
    if (v) out.push(v);
  }
  return out;
}

/** Motifs des workspaces : pnpm-workspace.yaml pour pnpm s'il existe, sinon `workspaces` (tableau ou `{ packages }`). */
export function workspacePatterns(pkg, pm, yaml) {
  if (pm === 'pnpm' && typeof yaml === 'string') return parsePnpmWorkspace(yaml);
  const w = pkg?.workspaces;
  const list = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : [];
  return list.filter((s) => typeof s === 'string');
}

/**
 * Motifs → globs de `<motif>/package.json` relatifs au cwd : `{ include, exclude, refused }`. `!motif` va dans `exclude`.
 * Refusés : motif absolu, avec `..` ou antislash (on ne sort pas du dossier). node_modules et dossiers cachés toujours exclus.
 */
export function workspaceGlobs(patterns) {
  const include = [], exclude = ['**/node_modules', '**/node_modules/**', '**/.*', '**/.*/**'], refused = [];
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    const p = (neg ? raw.slice(1) : raw).trim();
    if (!p || p.includes('\\') || path.posix.isAbsolute(p) || p.split('/').includes('..')) { refused.push(raw); continue; }
    // Motifs de workspaces : toujours en `/` (format npm / pnpm), d'où path.posix.
    const clean = path.posix.normalize(p).replace(/\/+$/, '');
    if (neg) exclude.push(clean);
    else if (clean !== '.') include.push(path.posix.join(clean, 'package.json'));
  }
  return { include, exclude, refused };
}

/** argv d'un script (jamais npx, jamais d'installation) ; `ws` = nom du workspace ou null pour la racine. */
export function runArgv(pm, script, ws) {
  if (!ws) return [pm, 'run', script];
  if (pm === 'pnpm') return ['pnpm', '--filter', ws, 'run', script];
  if (pm === 'yarn') return ['yarn', 'workspace', ws, 'run', script]; // classic et berry
  if (pm === 'bun') return ['bun', 'run', '--filter', ws, script];
  return ['npm', 'run', `--workspace=${ws}`, script];
}

/**
 * Scripts lançables d'un package.json, dans son ordre ; `budget` `{ left, truncated }` borne la taille totale en octets
 * de JSON (accents et échappements compris, comme le compte le runner), sinon `truncated`.
 */
export function scriptsOf(pkg, budget) {
  const s = pkg?.scripts;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [];
  const out = [];
  for (const [name, command] of Object.entries(s)) {
    if (typeof command !== 'string' || !SCRIPT.test(name)) continue;
    const c = cut(command, MAX_COMMAND);
    budget.left -= Buffer.byteLength(JSON.stringify(name + c));
    if (budget.left < 0) { budget.truncated = true; break; }
    out.push({ name, command: c });
  }
  return out;
}

// ── I/O (ne rejettent jamais, sauf readJson) ────────────────────────────

/** Objet JSON d'un fichier de 1 Mo au plus ; lève sinon (absent, trop gros, illisible, pas un objet). */
async function readJson(file) {
  const st = await fs.promises.stat(file);
  if (!st.isFile() || st.size > MAX_JSON) throw new Error('trop gros');
  const v = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('objet attendu');
  return v;
}

/** Gestionnaire du cwd, en remontant jusqu'au dossier qui contient .git (10 niveaux au plus) ; npm par défaut. */
async function findManager(cwd) {
  let dir = cwd;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const names = await fs.promises.readdir(dir).catch(() => []);
    const r = detectManager(await readJson(path.join(dir, 'package.json')).catch(() => null), names);
    if (r) {
      const rel = path.relative(cwd, dir);
      if (!rel) return r;
      const from = r.from === 'packageManager' ? `packageManager (${path.join(rel, 'package.json')})` : r.from === 'par défaut' ? r.from : path.join(rel, r.from);
      return { ...r, from };
    }
    const parent = path.dirname(dir);
    if (names.includes('.git') || parent === dir) break;
    dir = parent;
  }
  return { pm: 'npm', from: 'par défaut', warning: null };
}

/** Projet du cwd (forme NpmProject). Workspaces : glob, puis realpath sous celui du cwd (un lien ne fait pas sortir). */
export async function readProject(cwd, signal) {
  const base = { pm: 'npm', from: 'par défaut', warning: null, scripts: [], workspaces: [], truncated: false, error: null };
  let real, pkg;
  try { real = await fs.promises.realpath(cwd); } catch { return { ...base, error: 'dossier introuvable' }; }
  try { pkg = await readJson(path.join(cwd, 'package.json')); } catch (e) {
    return { ...base, error: e?.code === 'ENOENT' ? 'package.json introuvable' : 'package.json illisible' };
  }
  const mgr = await findManager(cwd);
  const warnings = mgr.warning ? [mgr.warning] : [];
  let yaml = null;
  if (mgr.pm === 'pnpm') {
    const f = path.join(cwd, 'pnpm-workspace.yaml');
    const st = await fs.promises.stat(f).catch(() => null);
    if (st?.isFile() && st.size <= MAX_JSON) yaml = await fs.promises.readFile(f, 'utf8').catch(() => null);
  }
  const { include, exclude, refused } = workspaceGlobs(workspacePatterns(pkg, mgr.pm, yaml));
  if (refused.length) warnings.push(`Motifs de workspace refusés : ${refused.map((r) => cut(r, 100)).join(', ')}`);
  const budget = { left: MAX_TEXT, truncated: false };
  const out = { ...base, pm: mgr.pm, from: mgr.from, scripts: scriptsOf(pkg, budget) };

  if (include.length) {
    const files = new Set();
    try {
      // ponytail: un `**` sur un très gros dépôt est borné par MAX_MATCHES et le délai de la méthode (10 s), pas plus fin.
      for await (const f of fs.promises.glob(include, { cwd, exclude })) {
        if (signal?.aborted) break;
        files.add(f);
        if (files.size >= MAX_MATCHES) { out.truncated = true; break; }
      }
    } catch (e) { warnings.push(`Workspaces illisibles : ${cut(String(e?.message ?? e), 200)}`); }
    const names = new Set();
    for (const f of [...files].sort()) {
      if (signal?.aborted) break;
      const dir = path.dirname(f);
      if (dir === '.') continue;
      const file = path.join(cwd, f);
      const r = await fs.promises.realpath(file).catch(() => null);
      if (!r || !r.startsWith(real + path.sep)) continue;
      const w = await readJson(file).catch(() => null);
      if (!w || typeof w.name !== 'string' || !NAME.test(w.name) || names.has(w.name)) continue;
      if (out.workspaces.length >= MAX_WORKSPACES) { out.truncated = true; break; }
      names.add(w.name);
      out.workspaces.push({ name: w.name, dir, scripts: scriptsOf(w, budget) });
    }
  }
  out.truncated ||= budget.truncated;
  out.warning = warnings.join(' ; ') || null;
  return out;
}

export default (vigie) => vigie.definePlugin({
  id: 'npm',
  name: 'Scripts npm',
  session: {
    // Lecture d'un seul fichier : un package.json objet suffit. Pas de badge (compter les workspaces coûterait un glob).
    async detect({ cwd }) {
      return readJson(path.join(cwd, 'package.json')).then(() => true, () => false);
    },
    methods: {
      project: { result: NpmProject, timeout: 10_000, handler: ({ cwd, signal }) => readProject(cwd, signal) },
    },
    actions: {
      run: {
        params: NpmRunParams,
        async handler({ cwd, params, signal }) {
          // Relu à l'instant (pas cru sur parole) : gestionnaire, workspace et script doivent être dans la liste.
          const p = await readProject(cwd, signal);
          if (p.error) throw vigie.error(p.error);
          const ws = params.workspace ?? null;
          const scripts = ws === null ? p.scripts : p.workspaces.find((w) => w.name === ws)?.scripts;
          if (!scripts) throw vigie.error('Workspace inconnu');
          if (!scripts.some((s) => s.name === params.script)) throw vigie.error('Script inconnu');
          return vigie.terminal(runArgv(p.pm, params.script, ws), { title: ws ? `${ws} : ${params.script}` : params.script });
        },
      },
    },
  },
});
