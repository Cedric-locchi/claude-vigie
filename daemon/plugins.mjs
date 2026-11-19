// Plugins du daemon (décisions 034, 037) : lecture des manifestes, SDK passé aux plugins, exécution encadrée de leurs appels.
// Un plugin est un module ESM de plugins/<id>/ qui exporte par défaut `(vigie) => vigie.definePlugin({...})`. Il n'importe rien
// de Vigie (seulement son propre contract.mjs) : tout ce dont il a besoin (zod, exec, terminal) arrive par le SDK.
// Le back d'un plugin expose des méthodes (JSON libre, lu par son front Angular) et des actions qui décrivent un terminal
// (argv, quoté ici) que seul le transport ouvre.
// Un plugin désactivé n'est jamais importé : son code ne tourne pas.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/mini';
import { shQuote } from './launch.mjs';

/** Version de l'API du SDK ; un plugin qui en demande une autre ne peut pas être activé. */
export const API = 2;
/** Délais par appel (ms) : detect doit être rapide (sinon le plugin est compté absent) ; `call` par défaut, `slow` plafond
 *  du `timeout` d'une méthode. */
export const TIMEOUTS = { detect: 3000, call: 10_000, slow: 60_000 };
/** Taille max de la réponse JSON d'une méthode. */
export const MAX_RESULT = 4 * 1024 * 1024;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VALID = Symbol('vigie.plugin');
const TERMINAL = Symbol('vigie.terminal');
const MAX_ARGS = 64;
const MAX_ARG = 8000;
const NAME = /^[\w-]{1,64}$/;

// Erreurs produites ici (et par vigie.error) : leur message va tel quel à l'utilisateur, avec leur code HTTP.
// Toute autre exception d'un plugin devient un 500 générique.
const ours = new WeakSet();
const fail = (status, message) => { const e = Object.assign(new Error(message), { status }); ours.add(e); return e; };

/**
 * Manifestes des plugins : `plugins/<id>/package.json`, champ `vigie` `{ api, id, name, description }`. Lecture synchrone, aucun import.
 * Dossier sans package.json ou sans `vigie`, ou nom de dossier hors `^[a-z0-9][a-z0-9-]{0,39}$` : ignoré.
 * `api` non supportée ou `vigie.id` différent du dossier : listé avec `error` (le plugin ne peut pas être activé).
 * → `[{ id, name, description, api, entry, error }]`, triés par id.
 */
export function readManifests(dir) {
  let names;
  // readdirSync + statSync plutôt que `withFileTypes` : le type des entrées n'est pas garanti dans app.asar.
  try { names = fs.readdirSync(dir).filter((n) => ID.test(n)).sort(); } catch { return []; }
  names = names.filter((n) => { try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch { return false; } });
  const out = [];
  for (const id of names) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, id, 'package.json'), 'utf8')); } catch { continue; }
    const v = pkg?.vigie;
    if (!v || typeof v !== 'object') continue;
    const error = v.api !== API ? `API de plugin non supportée (${JSON.stringify(v.api ?? null)}, attendue ${API})`
      : v.id !== id ? `Identifiant « ${v.id} » différent du dossier « ${id} »` : null;
    out.push({
      id,
      name: typeof v.name === 'string' && v.name ? v.name : id,
      description: typeof v.description === 'string' ? v.description : '',
      api: v.api,
      // ponytail: point d'entrée fixe (index.mjs), `main` ignoré : rien à valider ; lire `main` (sans sortie du dossier) si un plugin en a besoin.
      entry: path.join(dir, id, 'index.mjs'),
      error,
    });
  }
  return out;
}

/** Groupes de processus vivants lancés par `exec` (pid du chef de groupe) : `killAll` les tue à l'arrêt du daemon. */
const groups = new Set();

/** Tue tous les groupes lancés par `exec` encore vivants (arrêt du daemon : pas d'outil orphelin). */
export function killAll() {
  for (const pid of groups) { try { process.kill(-pid, 'SIGKILL'); } catch { /* déjà mort */ } }
  groups.clear();
}

/**
 * Lance un programme sans shell et ne rejette jamais : `{ ok, code, stdout, stderr, missing, timedOut, error }`.
 * stdin fermé (un outil ne doit jamais attendre une réponse) ; groupe de processus à part (`detached`) : délai, `signal`
 * et sortie > `maxBuffer` tuent tout le groupe (`kill(-pid)`), petits-enfants compris (POSIX, macOS et Linux).
 * `env` : surcharges de `baseEnv` (null = variable retirée). `bins` : réécrit argv[0] (faux exécutables des tests).
 */
export function exec(argv, { cwd, timeout = 10_000, env = {}, signal, maxBuffer = 8 * 1024 * 1024 } = {}, { baseEnv = process.env, bins = {} } = {}) {
  const base = { ok: false, code: null, stdout: '', stderr: '', missing: false, timedOut: false, error: null };
  return new Promise((resolve) => {
    if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) return resolve({ ...base, error: 'argv invalide' });
    // Un cwd disparu ferait lever ENOENT au spawn, pris pour « programme absent ».
    if (typeof cwd !== 'string' || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return resolve({ ...base, error: 'dossier introuvable' });
    if (signal?.aborted) return resolve({ ...base, error: 'annulé' });
    const fullEnv = { ...baseEnv };
    for (const [k, v] of Object.entries(env ?? {})) { if (v === null) delete fullEnv[k]; else fullEnv[k] = String(v); }
    const bin = Object.hasOwn(bins, argv[0]) ? bins[argv[0]] : argv[0];
    let child;
    try { child = spawn(bin, argv.slice(1), { cwd, env: fullEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ...base, error: e.message }); }
    if (child.pid) groups.add(child.pid);
    const out = { stdout: [], stderr: [] };
    let size = 0, why = null, done = false;
    const kill = (reason) => {
      why ??= reason;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* déjà mort */ } }
    };
    // Borné : Infinity ou NaN donneraient un délai de 1 ms (setTimeout), un délai énorme un outil jamais tué.
    const timer = setTimeout(() => kill('timeout'), Math.min(Math.max(+timeout || 10_000, 1), 600_000));
    const onAbort = () => kill('abort');
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const k of ['stdout', 'stderr']) child[k].on('data', (b) => {
      size += b.length;
      if (size > maxBuffer) { if (!why) kill('overflow'); return; }
      out[k].push(b);
    });
    const finish = (err, code) => {
      if (done) return;
      done = true;
      groups.delete(child.pid);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const stdout = Buffer.concat(out.stdout).toString(), stderr = Buffer.concat(out.stderr).toString();
      if (err) return resolve({ ...base, stdout, stderr, missing: err.code === 'ENOENT', error: err.code === 'ENOENT' ? `${argv[0]} introuvable` : err.message });
      const error = why === 'timeout' ? `${argv[0]} ne répond pas` : why === 'abort' ? 'annulé' : why === 'overflow' ? 'sortie trop volumineuse'
        : code !== 0 ? `${argv[0]} : code ${code}` : null;
      resolve({ ...base, ok: !error, code, stdout, stderr, timedOut: why === 'timeout', error });
    };
    child.on('error', (err) => finish(err)); // ENOENT, EACCES
    child.on('close', (code, sig) => finish(null, code ?? sig));
  });
}

/**
 * Terminal décrit par un plugin : jamais une chaîne de shell, un argv que le daemon quote (shQuote) argument par argument.
 * Refusé (400) : argv vide ou trop long, argument non texte ou trop long, octet nul, antislash (sous fish, `\'` sortirait des
 * guillemets de shQuote), programme vide ou en `-` (pris pour une option).
 */
function terminal(argv, { title } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.length > MAX_ARGS) throw fail(400, 'Commande invalide');
  for (const a of argv) {
    if (typeof a !== 'string' || a.length > MAX_ARG || a.includes('\0')) throw fail(400, 'Argument de commande invalide');
    if (a.includes('\\')) throw fail(400, 'Antislash refusé dans une commande');
  }
  if (!argv[0] || argv[0].startsWith('-')) throw fail(400, 'Commande invalide');
  return Object.freeze({ [TERMINAL]: true, argv: [...argv], title: String(title ?? argv[0]).slice(0, 200) });
}

/** SDK passé à la fabrique d'un plugin. `id` null : celui du plugin est accepté tel quel (harnais de test). */
export function createSdk({ id = null, baseEnv = process.env, dataDir, bins = {} }) {
  const isFn = (f) => typeof f === 'function';
  function definePlugin(def) {
    if (!def || typeof def !== 'object') throw new Error('definePlugin attend un objet');
    if (typeof def.id !== 'string' || !ID.test(def.id) || (id !== null && def.id !== id)) throw new Error(`Identifiant de plugin « ${def.id} » invalide (attendu « ${id ?? 'a-z0-9-'} »)`);
    const s = def.session;
    if (!s || !isFn(s.detect)) throw new Error(`Plugin ${def.id} : session.detect doit être une fonction`);
    // Méthodes (lecture, JSON) et actions (terminal) : même forme, `result` et `timeout` réservés aux méthodes.
    // Une action décrit un terminal (rapide, délai `call`) : un `timeout` y serait ignoré, il est donc refusé.
    const table = (kind, keys) => {
      const t = s[kind] ?? {};
      if (typeof t !== 'object' || Array.isArray(t)) throw new Error(`Plugin ${def.id} : session.${kind} doit être un objet`);
      for (const [name, x] of Object.entries(t)) {
        if (!NAME.test(name) || !x || !isFn(x.handler)) throw new Error(`Plugin ${def.id} : ${kind} « ${name} » sans handler`);
        for (const k of keys) if (x[k] !== undefined && !isFn(x[k]?.safeParse)) throw new Error(`Plugin ${def.id} : ${k} de « ${name} » doit être un schéma zod`);
        if (kind === 'actions' && x.timeout !== undefined) throw new Error(`Plugin ${def.id} : timeout réservé aux méthodes, l'action « ${name} » n'en a pas (délai fixe de ${TIMEOUTS.call} ms)`);
        if (x.timeout !== undefined && !(Number.isInteger(x.timeout) && x.timeout >= 1 && x.timeout <= 60_000)) throw new Error(`Plugin ${def.id} : timeout de « ${name} » hors de 1 à 60000 ms`);
      }
      return Object.freeze({ ...t });
    };
    const methods = table('methods', ['params', 'result']);
    const actions = table('actions', ['params']);
    for (const name of Object.keys(methods)) if (Object.hasOwn(actions, name)) throw new Error(`Plugin ${def.id} : « ${name} » est à la fois méthode et action`);
    return Object.freeze({ ...def, session: Object.freeze({ ...s, methods, actions }), [VALID]: true });
  }
  return Object.freeze({
    definePlugin,
    z,
    exec: (argv, opts) => exec(argv, opts, { baseEnv, bins }),
    terminal,
    error: (message) => fail(400, String(message)),
    dataDir,
  });
}

/**
 * Charge un plugin (`factory(sdk)` → definePlugin) et renvoie son runner `{ id, detect, call, action }`, commun au daemon et aux tests.
 * Chaque appel : délai (puis `signal` annulé), exception isolée (500, pile journalisée), sortie vérifiée.
 */
export function loadPlugin(factory, sdkOpts, { timeouts = TIMEOUTS } = {}) {
  const def = factory(createSdk(sdkOpts));
  if (!def?.[VALID]) throw new Error(`Le plugin ${sdkOpts.id ?? ''} doit renvoyer vigie.definePlugin(…)`);
  const { id } = def;
  const { session } = def;

  // `signal` : abandon côté appelant (requête HTTP fermée), combiné au délai ; le handler ne voit qu'un signal.
  async function run(fn, ms, ctx, signal) {
    const ac = new AbortController();
    const sig = signal ? AbortSignal.any([ac.signal, signal]) : ac.signal;
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => {
      ac.abort();
      console.error(`[vigie] plugin ${id} : pas de réponse en ${ms} ms`);
      reject(fail(504, `Le plugin ${id} ne répond pas`));
    }, ms); });
    try {
      return await Promise.race([Promise.resolve().then(() => fn({ ...ctx, signal: sig })), late]);
    } catch (e) {
      if (ours.has(e)) throw e;
      console.error(`[vigie] plugin ${id} :`, e);
      throw fail(500, `Le plugin ${id} a échoué : ${e?.message ?? e}`);
    } finally { clearTimeout(timer); }
  }

  // Sans schéma, le handler ne reçoit rien de l'UI : il ne peut pas croire sur parole ce qu'il n'a pas décrit.
  const input = (schema, v) => {
    if (!schema) return {};
    const r = schema.safeParse(v ?? {});
    if (!r.success) throw fail(400, r.error.issues[0]?.message ?? 'Paramètres invalides');
    return r.data;
  };

  return {
    id,
    /** null si le plugin ne s'applique pas, lève, ou dépasse son délai (compté absent) ; sinon `{}` ou `{ badge }`. */
    async detect(cwd) {
      let r;
      // Déjà journalisé par `run` (exception ou délai).
      try { r = await run(session.detect, timeouts.detect, { cwd }); } catch { return null; }
      if (r === true) return {};
      if (r && typeof r === 'object') return r.badge == null ? {} : { badge: String(r.badge).slice(0, 20) };
      return null;
    },
    /** Méthode `name` → valeur JSON (`undefined` → null), vérifiée par son `result` s'il existe. `signal` : abandon de l'appelant. */
    async call(cwd, name, params, { signal } = {}) {
      const mt = Object.hasOwn(session.methods, name) ? session.methods[name] : null;
      if (!mt) throw fail(404, 'Méthode inconnue');
      const out = await run(async (ctx) => mt.handler({ ...ctx, params: input(mt.params, params) }), Math.min(mt.timeout ?? timeouts.call, timeouts.slow), { cwd }, signal);
      let text;
      try { text = JSON.stringify(out ?? null); } catch (e) { throw fail(500, `Réponse non sérialisable du plugin ${id} : ${e?.message ?? e}`); }
      // Fonction ou symbole à la racine : stringify renvoie undefined au lieu de lever (BigInt et cycles, eux, lèvent).
      if (text === undefined) throw fail(500, `Réponse non sérialisable du plugin ${id}`);
      if (Buffer.byteLength(text) > MAX_RESULT) throw fail(500, 'Réponse trop volumineuse');
      // Reparsé : le transport renvoie exactement ce que le JSON porte (Date → texte, champs undefined retirés).
      const data = JSON.parse(text);
      if (!mt.result) return data;
      const r = mt.result.safeParse(data);
      if (!r.success) {
        const issue = r.error.issues[0];
        throw fail(500, `Réponse invalide du plugin ${id} : ${issue?.path?.length ? issue.path.join('.') + ' : ' : ''}${issue?.message ?? 'forme inconnue'}`);
      }
      return r.data;
    },
    /** Action `aid` → `{ terminal: { argv, title, command } }` ; le handler doit renvoyer `vigie.terminal(…)`. */
    async action(cwd, aid, { params } = {}) {
      const a = Object.hasOwn(session.actions, aid) ? session.actions[aid] : null;
      if (!a) throw fail(404, 'Action inconnue');
      return run(async (ctx) => {
        const out = await a.handler({ ...ctx, params: input(a.params, params) });
        if (out?.[TERMINAL]) return { terminal: { argv: out.argv, title: out.title, command: out.argv.map(shQuote).join(' ') } };
        throw fail(500, `Réponse invalide du plugin ${id} : vigie.terminal(…) attendu`);
      }, timeouts.call, { cwd });
    },
  };
}

/**
 * Plugins du dossier `dir` (lus une fois) ; `enabled` : état enregistré (`settings.plugins`), désactivés par défaut.
 * Chargement mémoïsé : un plugin activé est importé au démarrage (en tâche de fond) ou à son activation, jamais s'il est désactivé.
 */
export function createPlugins({ dir, dataRoot, baseEnv = process.env, enabled = {}, timeouts = TIMEOUTS }) {
  const manifests = dir ? readManifests(dir) : [];
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const on = new Map(manifests.map((m) => [m.id, enabled[m.id] === true && !m.error]));
  const loaded = new Map(); // id → Promise<runner>
  const loadErrors = new Map(); // id → message montré sur la carte

  function load(m) {
    // ponytail: un échec de chargement reste mémorisé jusqu'au redémarrage (import() garde aussi l'erreur en cache) ; relancer le daemon après correction.
    if (!loaded.has(m.id)) {
      const p = (async () => {
        const mod = await import(pathToFileURL(m.entry).href);
        if (typeof mod.default !== 'function') throw new Error('export par défaut (vigie) => vigie.definePlugin(…) attendu');
        const dataDir = path.join(dataRoot, m.id);
        fs.mkdirSync(dataDir, { recursive: true });
        return loadPlugin(mod.default, { id: m.id, baseEnv, dataDir }, { timeouts });
      })();
      p.catch((e) => { loadErrors.set(m.id, String(e?.message ?? e)); console.error(`[vigie] plugin ${m.id} non chargé :`, e); });
      loaded.set(m.id, p);
    }
    return loaded.get(m.id);
  }

  // Plugins activés : importés dès le démarrage, en tâche de fond, pour qu'un import cassé se voie (list, active) sans attendre
  // le premier detect. load() attache déjà son catch : aucun rejet non géré.
  for (const m of manifests) if (on.get(m.id)) load(m);

  const info = (m) => ({ id: m.id, name: m.name, description: m.description, enabled: on.get(m.id), error: m.error ?? loadErrors.get(m.id) ?? null });

  async function runner(id) {
    const m = byId.get(id);
    if (!m || !on.get(id)) throw fail(404, 'Plugin désactivé ou indisponible');
    try { return await load(m); } catch { throw fail(404, 'Plugin désactivé ou indisponible'); }
  }

  return {
    list: () => manifests.map(info),
    /** Plugins activés et chargeables (un import en échec n'est pas actif ; son erreur est dans list()). */
    active: () => manifests.filter((m) => on.get(m.id) && !loadErrors.has(m.id)).map((m) => m.id),
    async setEnabled(id, value) {
      const m = byId.get(id);
      if (!m) throw fail(404, 'Plugin inconnu');
      if (value) {
        if (m.error) throw fail(400, m.error);
        try { await load(m); } catch (e) { throw fail(400, `Le plugin ${id} ne se charge pas : ${e?.message ?? e}`); }
      }
      // ponytail: désactivé, le module reste en mémoire jusqu'au redémarrage (on cesse seulement de l'appeler) ; sans effet tant que son code ne change pas.
      on.set(id, value);
      return info(m);
    },
    /** Plugins actifs qui s'appliquent au dossier, en parallèle ; un plugin lent ou en erreur est compté absent. */
    async detect(cwd) {
      const found = await Promise.all(manifests.filter((m) => on.get(m.id)).map(async (m) => {
        const r = await runner(m.id).catch(() => null);
        const d = r && (await r.detect(cwd));
        return d ? { id: m.id, name: m.name, ...d } : null;
      }));
      return found.filter(Boolean);
    },
    call: async (id, method, cwd, params, opts) => (await runner(id)).call(cwd, method, params, opts),
    action: async (id, aid, cwd, body) => (await runner(id)).action(cwd, aid, body),
  };
}

/**
 * Harnais de test d'un plugin (node:test) : même runner, mêmes validations et mêmes erreurs que dans le daemon.
 * `bins` : `{ mise: '/chemin/faux-mise' }` réécrit argv[0] dans exec (jamais dans terminal, dont l'argv reste celui du plugin).
 */
export function testPlugin(factory, { bins = {}, env = process.env, dataDir, timeouts = TIMEOUTS, id = null } = {}) {
  return loadPlugin(factory, { id, baseEnv: env, dataDir: dataDir ?? tempDir('vigie-plugin-'), bins }, { timeouts });
}

const temps = new Set();
/**
 * Dossier temporaire effacé à la sortie du process (un fichier de test = un process sous `node --test`) : `npm test` ne laisse rien.
 * Exporté pour les tests des plugins et du daemon.
 */
export function tempDir(prefix = 'vigie-test-') {
  if (!temps.size) process.once('exit', () => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); temps.clear(); });
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.add(d);
  return d;
}
