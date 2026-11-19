// Plugin Nx (décision 037) : onglet « Nx » d'une session, projets et cibles de l'espace, `nx run p:t` dans un terminal.
// Lecture par `nx graph --file=stdout` : elle exécute le code du dépôt (plugins Nx, configs vite / jest), d'où une lecture
// à l'ouverture de l'onglet seulement (jamais dans detect), bornée à 55 s, groupe tué au-delà.
// Ni démon Nx, ni Nx Cloud, ni installation par le wrapper ; cache de Nx sous vigie.dataDir, jamais dans le dépôt.
// Télémétrie : aucune variable ne la coupe, donc `"analytics": true` dans nx.json → le graphe n'est pas lu (nx n'est pas lancé).
// Exécutable : node_modules/.bin/nx du dépôt, sinon nx du PATH ; jamais npx (téléchargement).
// N'importe rien de Vigie : le SDK arrive en argument (`vigie`), les schémas partagés avec le front sont dans ./contract.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ID, NxGraph, NxInfo, NxRunParams } from './contract.mjs';

const MAX_ERROR = 500;
const MAX_TEXT = 2000;
const MAX_NXJSON = 1024 * 1024;
/** Projets (en JSON, octets) : la réponse reste sous les 4 Mo du runner, sinon `truncated`. */
export const MAX_GRAPH = 3 * 1024 * 1024;
/** nx du dépôt, relatif au cwd (le terminal s'ouvre dans le cwd de la session). */
export const LOCAL_NX = path.join('node_modules', '.bin', 'nx');
export const TELEMETRY = 'Télémétrie Nx activée dans nx.json : Vigie ne lit pas le graphe (requête sortante).';

const cut = (s, n = MAX_ERROR) => { const t = String(s).trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const text = (v) => (typeof v === 'string' ? v : '');

// ── Fonctions pures ─────────────────────────────────────────────────────

/** Environnement de la lecture : pas de démon ni de cloud, pas d'installation par le wrapper, cache dans `dir`. Pas de CI. */
export const ENV = (dir) => ({ NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_WRAPPER_SKIP_INSTALL: 'true', NX_WORKSPACE_DATA_DIRECTORY: dir });

/** Cache Nx propre au dossier (realpath), sous le dataDir du plugin. */
// ponytail: jamais nettoyé ; purger les dossiers dont l'espace Nx a disparu si la place compte.
export const dataDirFor = (dataDir, real) => path.join(dataDir, crypto.createHash('sha256').update(real).digest('hex').slice(0, 12));

/** argv du terminal de `nx run p:t` (projet et cible déjà passés par ID). */
export const runArgv = (local, project, target) => [local ? LOCAL_NX : 'nx', 'run', `${project}:${target}`];

/** Commande montrée d'une cible : run-commands, script de package.json, sinon l'exécuteur. */
function commandOf(t) {
  const o = t?.options ?? {};
  if (typeof o.command === 'string') return o.command;
  if (Array.isArray(o.commands)) return o.commands.map((c) => (typeof c === 'string' ? c : text(c?.command))).filter(Boolean).join(' && ');
  return text(t?.metadata?.scriptContent) || text(t?.executor);
}

/**
 * Sortie de `nx graph --file=stdout` → `{ projects, truncated }` : projets triés (forme NxProject), coupés quand leur JSON
 * dépasse `max` octets. Lève si le JSON est illisible.
 */
// ponytail: coupe au projet entier (un projet seul plus gros que le budget n'apparaît pas) ; couper ses cibles si un dépôt le demande.
export function parseNxGraph(stdout, max = MAX_GRAPH) {
  const s = String(stdout);
  // Nx peut écrire des avertissements avant le JSON : on part de la première ligne qui commence par `{`.
  const i = s.search(/^\{/m);
  if (i < 0) throw new Error('JSON attendu');
  const nodes = JSON.parse(s.slice(i))?.graph?.nodes;
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) throw new Error('graph.nodes attendu');
  const byName = (a, b) => a.name.localeCompare(b.name, 'en');
  const all = Object.entries(nodes).map(([key, n]) => {
    const name = text(n?.name) || key;
    const d = n?.data && typeof n.data === 'object' ? n.data : {};
    const targets = d.targets && typeof d.targets === 'object' && !Array.isArray(d.targets) ? d.targets : {};
    return {
      name,
      type: text(n?.type) || text(d.projectType),
      root: text(d.root),
      targets: Object.entries(targets).map(([t, x]) => ({
        name: t,
        command: cut(commandOf(x), MAX_TEXT),
        description: cut(text(x?.metadata?.description), MAX_TEXT),
        runnable: ID.test(name) && ID.test(t),
      })).sort(byName),
    };
  }).sort(byName);
  let left = max;
  const over = all.findIndex((p) => (left -= Buffer.byteLength(JSON.stringify(p)) + 1) < 0);
  return over < 0 ? { projects: all, truncated: false } : { projects: all.slice(0, over), truncated: true };
}

// ── I/O ─────────────────────────────────────────────────────────────────

/** `{ local, telemetry }` d'après nx.json et node_modules/.bin/nx ; null si nx.json est absent ou illisible. */
export async function readInfo(cwd) {
  const f = path.join(cwd, 'nx.json');
  const st = await fs.promises.stat(f).catch(() => null);
  if (!st?.isFile() || st.size > MAX_NXJSON) return null;
  const json = await fs.promises.readFile(f, 'utf8').catch(() => null);
  if (json === null) return null;
  // stat suit le lien de node_modules/.bin.
  const local = (await fs.promises.stat(path.join(cwd, LOCAL_NX)).catch(() => null))?.isFile() ?? false;
  return { local, telemetry: /"analytics"\s*:\s*true/.test(json) };
}

/** Graphe Nx du dossier (forme NxGraph). Ne rejette jamais. */
export async function readGraph(vigie, cwd, signal) {
  const none = { available: true, projects: [], truncated: false };
  const info = await readInfo(cwd);
  if (!info) return { ...none, error: 'nx.json introuvable' };
  if (info.telemetry) return { ...none, error: TELEMETRY };
  let data;
  try {
    data = dataDirFor(vigie.dataDir, await fs.promises.realpath(cwd));
    await fs.promises.mkdir(data, { recursive: true });
  } catch { return { ...none, error: 'dossier introuvable' }; }
  const exe = info.local ? path.join(cwd, LOCAL_NX) : 'nx';
  const r = await vigie.exec([exe, 'graph', '--file=stdout'], { cwd, timeout: 55_000, maxBuffer: 32 * 1024 * 1024, env: ENV(data), signal });
  if (r.missing) return { ...none, available: false, error: null };
  if (r.timedOut) return { ...none, error: 'nx ne répond pas' };
  if (!r.ok) return { ...none, error: cut(r.stderr) || r.error };
  try { return { ...none, ...parseNxGraph(r.stdout), error: null }; } catch { return { ...none, error: 'sortie de nx illisible' }; }
}

export default (vigie) => {
  const info = async (cwd) => {
    const i = await readInfo(cwd);
    if (!i) throw vigie.error('Pas un espace Nx');
    return i;
  };

  return vigie.definePlugin({
    id: 'nx',
    name: 'Nx',
    session: {
      // Fichier seulement : jamais nx ici (il exécuterait le code du dépôt à chaque session).
      async detect({ cwd }) {
        return (await fs.promises.stat(path.join(cwd, 'nx.json')).catch(() => null))?.isFile() ?? false;
      },
      methods: {
        info: { result: NxInfo, timeout: 10_000, handler: ({ cwd }) => info(cwd) },
        graph: { result: NxGraph, timeout: 60_000, handler: ({ cwd, signal }) => readGraph(vigie, cwd, signal) },
      },
      actions: {
        run: {
          params: NxRunParams,
          // Le graphe n'est pas relu (trop lent) : projet et cible passent ID, puis le SDK quote ; seul nx.json est relu.
          async handler({ cwd, params }) {
            const i = await info(cwd);
            return vigie.terminal(runArgv(i.local, params.project, params.target), { title: `${params.project}:${params.target}` });
          },
        },
      },
    },
  });
};
