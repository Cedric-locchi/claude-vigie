// Adaptateur mise (https://mise.jdx.dev/) : tâches du dossier d'une session, en lecture seule.
// Jamais `mise trust` ici, jamais `--yes` ni `--hidden` : faire confiance à une config est un geste de l'utilisateur (POST …/terminals).
// Effet de bord assumé : mise tient son propre état (~/.local/state/mise : configs suivies), même en lecture.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_ERROR = 500;

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

/**
 * Tâches mise du dossier : `{ available, untrusted, tasks, error }`. Ne rejette jamais.
 * `env` : environnement de mise (MISE_OFFLINE…), `bin` injectable pour les tests, `home` pour les chemins en `~/…`.
 */
export async function readMiseTasks(cwd, { env = process.env, bin = 'mise', timeout = 5000, home = os.homedir() } = {}) {
  const none = { available: true, untrusted: false, tasks: [] };
  let real;
  try {
    if (!fs.statSync(cwd).isDirectory()) throw new Error();
    real = fs.realpathSync(cwd); // mise rend des chemins résolus (/private/tmp sous macOS)
  } catch { return { ...none, error: 'dossier introuvable' }; }
  return new Promise((resolve) => {
    const child = execFile(bin, ['tasks', 'ls', '--json'], { cwd, env, timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return resolve({ available: false, untrusted: false, tasks: [], error: null });
      if (err && err.killed && err.signal === 'SIGKILL' && typeof err.code !== 'string') return resolve({ ...none, error: 'mise ne répond pas' });
      if (err) {
        const error = (typeof err.code === 'number' && miseError(stderr)) || err.message;
        return resolve({ ...none, untrusted: /not trusted/i.test(error), error });
      }
      try { resolve({ ...none, tasks: parseMiseTasks(stdout, real, home), error: null }); } catch { resolve({ ...none, error: 'sortie de mise illisible' }); }
    });
    // execFile ne transmet pas `stdio` : stdin fermé à la main, mise ne doit jamais attendre une réponse.
    child.stdin?.end();
    child.stdin?.on('error', () => {});
  });
}
