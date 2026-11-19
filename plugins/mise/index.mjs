// Plugin mise (https://mise.jdx.dev/) : onglet « Tâches mise » d'une session, tâches lancées dans un terminal.
// Lecture : jamais `mise trust`, jamais `--yes` ni `--hidden`, hors ligne et sans MISE_YES (pas d'approbation implicite).
// Faire confiance à une config est un geste de l'utilisateur : action `trust`, au clic seulement.
// Effet de bord assumé : mise tient son propre état (~/.local/state/mise : configs suivies), même en lecture.
// N'importe rien de Vigie : le SDK arrive en argument (`vigie`), les schémas partagés avec le front sont dans ./contract.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MiseRunParams, MiseTasks } from './contract.mjs';

const MAX_ERROR = 500;

/** Surcharges d'environnement de la lecture (null = variable retirée). */
export const ENV = { MISE_YES: null, MISE_OFFLINE: '1', MISE_HIDE_UPDATE_WARNING: '1' };

/** Chemin lisible : relatif au cwd s'il est dedans, sinon `~/…` sous le home, sinon absolu. */
function shortPath(p, cwd, home) {
  if (typeof p !== 'string' || !p) return null;
  const inside = (root) => { const rel = path.relative(root, p); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null; };
  return inside(cwd) ?? (home && inside(home) ? path.join('~', inside(home)) : p);
}

// `depends` / `run` peuvent contenir `{ task, args }` ou `{ tasks: [...] }` (tâches imbriquées) : on les rend en texte.
const asText = (x) => {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    if (typeof x.task === 'string') return [x.task, ...(Array.isArray(x.args) ? x.args.map(String) : [])].join(' ');
    if (Array.isArray(x.tasks)) return x.tasks.map(asText).join(', ');
  }
  return JSON.stringify(x) ?? '';
};
const texts = (a) => (Array.isArray(a) ? a.map(asText) : typeof a === 'string' ? [a] : []);

/** Sortie de `mise tasks ls --json` → tâches normalisées ; jamais `env`, `secrets` ni `tools`. Lève si le JSON est illisible ou n'est pas un tableau. */
export function parseMiseTasks(stdout, cwd, home) {
  const list = JSON.parse(stdout);
  if (!Array.isArray(list)) throw new Error('tableau attendu');
  return list.filter((t) => t && typeof t.name === 'string' && t.name).map((t) => ({
    name: t.name,
    aliases: Array.isArray(t.aliases) ? t.aliases.filter((a) => typeof a === 'string') : [],
    description: typeof t.description === 'string' ? t.description : '',
    source: shortPath(t.source, cwd, home) ?? '',
    depends: texts(t.depends),
    run: texts(t.run),
    file: shortPath(t.file, cwd, home),
    global: t.global === true,
  }));
}

/** Message d'erreur de mise : lignes `mise ERROR` (et leurs suites) sans préfixe, sans version ni conseil --verbose. */
export function miseError(stderr) {
  const out = [];
  let keep = false;
  for (const line of String(stderr).split('\n')) {
    const m = line.match(/^mise (ERROR|WARN|INFO|DEBUG|TRACE)\s+(.*)$/);
    if (m) keep = m[1] === 'ERROR' && !/^(Version:|Run with --verbose)/.test(m[2]);
    if (keep && (m ? m[2] : line).trim()) out.push((m ? m[2] : line).trim());
  }
  const msg = out.join('\n');
  return msg.length > MAX_ERROR ? msg.slice(0, MAX_ERROR) + '…' : msg;
}

// Fichiers de config mise d'un dossier (doc « Configuration » de mise), hors .tool-versions (outils seulement, jamais de tâche) :
// mise.toml, .mise.toml, leurs variantes .local et d'environnement (mise.dev.toml…), puis ceux des sous-dossiers.
const ROOT_TOML = /^\.?mise(\.[\w-]+)*\.toml$/;
const NESTED_TOML = [['mise', 'config.toml'], ['.mise', 'config.toml'], ['.config', 'mise.toml'], ['.config', 'mise', 'config.toml'], ['.config', 'mise', 'mise.toml']];
// Dossiers de tâches-fichiers : présents = tâches du projet.
const TASK_DIRS = [['mise-tasks'], ['.mise-tasks'], ['mise', 'tasks'], ['.mise', 'tasks'], ['.config', 'mise', 'tasks']];
// Une config déclare des tâches : `[tasks]`, `[tasks.x]`, `tasks.x = …`, ou `[task_config]` (includes d'autres fichiers).
const DECLARES_TASKS = /^\s*(\[\s*(tasks|task_config)\b|(tasks|task_config)\s*[.=])/m;
const MAX_TOML = 1024 * 1024;

/**
 * Le dossier (ou un parent, jusqu'à `stop` exclu, le home par défaut) a-t-il des tâches mise du projet ? Sans lancer mise :
 * config mise qui déclare des tâches, ou dossier de tâches-fichiers. `stop` exclu : ~/.config/mise est la config globale
 * (tâches `global`, qui suivent l'utilisateur partout et n'ouvrent pas l'onglet, comme avant les plugins).
 */
// ponytail: conf.d/*.toml et `task_config.includes` vers un autre dossier ne sont pas suivis ; les lire si un projet en dépend.
export async function hasProjectTasks(cwd, stop = os.homedir()) {
  const isDir = async (p) => (await fs.promises.stat(p).catch(() => null))?.isDirectory() ?? false;
  const declares = async (f) => {
    const st = await fs.promises.stat(f).catch(() => null);
    if (!st?.isFile()) return false;
    if (st.size > MAX_TOML) return true; // trop gros pour être lu ici : l'onglet tranchera
    return DECLARES_TASKS.test(await fs.promises.readFile(f, 'utf8').catch(() => ''));
  };
  for (let dir = path.resolve(cwd); dir !== stop; dir = path.dirname(dir)) {
    const names = await fs.promises.readdir(dir).catch(() => []);
    const files = [...names.filter((n) => ROOT_TOML.test(n)).map((n) => path.join(dir, n)), ...NESTED_TOML.map((p) => path.join(dir, ...p))];
    if ((await Promise.all(TASK_DIRS.map((p) => isDir(path.join(dir, ...p))))).some(Boolean)) return true;
    if ((await Promise.all(files.map(declares))).some(Boolean)) return true;
    if (path.dirname(dir) === dir) break; // racine
  }
  return false;
}

/** Tâches mise du dossier : `{ available, untrusted, tasks, error }`. Ne rejette jamais. */
export async function listTasks(vigie, cwd, signal) {
  const none = { available: true, untrusted: false, tasks: [] };
  let real;
  try {
    if (!fs.statSync(cwd).isDirectory()) throw new Error();
    real = fs.realpathSync(cwd); // mise rend des chemins résolus (/private/tmp sous macOS)
  } catch { return { ...none, error: 'dossier introuvable' }; }
  const r = await vigie.exec(['mise', 'tasks', 'ls', '--json'], { cwd, timeout: 5000, env: ENV, signal, maxBuffer: 4 * 1024 * 1024 });
  if (r.missing) return { available: false, untrusted: false, tasks: [], error: null };
  if (r.timedOut) return { ...none, error: 'mise ne répond pas' };
  if (!r.ok) {
    const error = (typeof r.code === 'number' && miseError(r.stderr)) || r.error;
    return { ...none, untrusted: /not trusted/i.test(error), error };
  }
  try { return { ...none, tasks: parseMiseTasks(r.stdout, real, os.homedir()), error: null }; } catch { return { ...none, error: 'sortie de mise illisible' }; }
}

export default (vigie) => vigie.definePlugin({
  id: 'mise',
  name: 'Tâches mise',
  session: {
    // Fichiers seulement, jamais mise (detect tourne pour chaque session à chaque ouverture) : onglet si une config mise du
    // projet déclare des tâches. Pas de badge (compter demanderait mise) ; mise absent ou config non approuvée : dit dans l'onglet.
    detect: ({ cwd }) => hasProjectTasks(cwd),
    methods: {
      // Toutes les tâches, globales comprises (le front les filtre et les range par secteur).
      tasks: { result: MiseTasks, timeout: 10_000, handler: ({ cwd, signal }) => listTasks(vigie, cwd, signal) },
    },
    actions: {
      run: {
        params: MiseRunParams,
        async handler({ cwd, params, signal }) {
          // Seul un nom listé par mise passe (relu ici, pas cru sur parole) ; un nom en `-…` serait pris pour une option.
          // `mise run -- <nom>` ne convient pas : mise y lit le nom comme argument de la tâche par défaut.
          const t = (await listTasks(vigie, cwd, signal)).tasks.find((x) => x.name === params.task || x.aliases.includes(params.task));
          if (!t || t.name.startsWith('-')) throw vigie.error('Tâche mise inconnue');
          return vigie.terminal(['mise', 'run', t.name], { title: t.name });
        },
      },
      // C'est l'utilisateur qui clique : seul endroit où Vigie lance `mise trust`. L'env du PTY reste le sien (réseau permis).
      trust: { handler: () => vigie.terminal(['mise', 'trust'], { title: 'mise trust' }) },
    },
  },
});
