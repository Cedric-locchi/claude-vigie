// Transport du daemon : HTTP (API + UI statique), WebSocket (/ws état, /pty/<id> terminal) et PTY.
// Écoute uniquement sur 127.0.0.1 (listen fait par server.mjs) ; WebSocket et POST refusent toute origine web étrangère
// (sinon n'importe quelle page ouverte dans le navigateur pourrait taper dans les terminaux).
// Aucun effet de bord à l'import ni à la création : rien n'écoute et aucun PTY n'est lancé tant qu'une requête ne le demande pas.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import pty from 'node-pty';
import { WebSocketServer } from 'ws';
// Chemin relatif, pas `@vigie/contract` : la copie des liens de workspace par electron-builder n'est pas garantie.
import { BranchBody, CommitBody, EmptyBody, FileQuery, HookEvent, InputBody, LogQuery, NewSessionBody, PluginActionBody, PluginCallBody, PluginToggleBody, ProjectsQuery, PtyMessage, RestoreBody, SearchQuery, SettingsBody, SettingsFile, TerminalBody, UsageQuery, WriteBody } from '../contract/index.mjs';
import { readClaudeConfig } from './claude-config.mjs';
import { listProjectFiles, readProjectFile, searchProjectFiles, writeProjectFile } from './files.mjs';
import { commitAll, createBranch, readGitDiff, readWorktreeFile, restoreFile, suggestCommitMessage, writeWorktreeFile } from './git.mjs';
import { csp, hostOk, staticFile } from './guard.mjs';
import { createPlugins } from './plugins.mjs';
import { listProjects } from './projects.mjs';
import { claudeCommand, shQuote, spoolLine } from './launch.mjs';
import { expandHome } from './paths.mjs';
import { defaultLocale, localeEnv, localeInstalled, managedSettingsFile } from './platform.mjs';
import { listLocales as systemLocales, readSettings, writeSettings } from './settings.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
const SCROLLBACK = 512 * 1024;

/**
 * `store` : createStore(…) ; `uiDir` : UI construite ; `home` : remplacé par `~` dans /api/projects ;
 * `platform` : process.platform, passé par server.mjs (seul module du daemon qui le lit) ; locale des PTY, réglages gérés de Claude ;
 * `chatDir` : dossier des discussions ; `hooksFile` : réglages passés à claude --settings ; `dev` : accepte ng serve (4200) ;
 * `listLocales` : sortie de `locale -a` (promesse de texte, null = indisponible) ; `settingsFile` : réglages du daemon (~/.vigie/settings.json), gardés en mémoire seulement s'il est absent ;
 * `spoolFile` : spool des hooks (~/.vigie/spool.jsonl), où POST /api/hook ajoute ce que Claude Code poste ;
 * `pluginsDir` : dossier des plugins livrés (plugins/ du dépôt, null = aucun) ; `pluginsDataDir` : leurs données (~/.vigie/plugins-data) ;
 * `commitDir` : dossier vide d'où part `claude -p` pour un message de commit (~/.vigie/commit-message, créé au premier clic).
 */
export function createTransport({ store, port, uiDir, home, platform, chatDir, hooksFile, settingsFile = null, spoolFile = null, dev = false, pluginsDir = null, pluginsDataDir = path.join(home, '.vigie', 'plugins-data'), commitDir = path.join(home, '.vigie', 'commit-message'), claudeStatus = () => undefined, listLocales = systemLocales }) {
  const ORIGINS = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(dev ? ['http://localhost:4200'] : [])]);
  const originOk = (req) => !req.headers.origin || ORIGINS.has(req.headers.origin);
  // Un GET same-origin du navigateur n'envoie pas `Origin`, mais `Sec-Fetch-Site: same-origin` (`none` : URL tapée) ; une page
  // étrangère (<img src>, fetch no-cors) envoie `cross-site` / `same-site`. La CLI et le process principal d'Electron ne l'envoient pas.
  const siteOk = (req) => { const s = req.headers['sec-fetch-site']; return s === undefined || s === 'same-origin' || s === 'none'; };
  const CSP = csp(port);

  // ── Réglages (settings.mjs : lecture tolérante, écriture tmp + rename) ──
  let settings = readSettings(settingsFile, SettingsFile);
  const settingsView = () => ({
    locale: settings.locale ?? null,
    defaultLocale: defaultLocale({ platform, env: cleanEnv }),
    alerts: settings.alerts ?? { dailyCost: null, windowPct: null },
  });
  const localeKnown = async (name) => { const l = await listLocales(); return l === null || localeInstalled(name, l); };
  /** Écrit puis applique : un échec d'écriture ne laisse pas une locale active mais oubliée au redémarrage. */
  function saveSettings(next) {
    writeSettings(settingsFile, next);
    settings = next;
  }

  // ── Terminaux (PTY) ─────────────────────────────────────────────────────
  const terminals = new Map();
  // Les terminaux ne doivent hériter ni de la session Claude parente, ni des réglages internes de l'app.
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDECODE') && !k.startsWith('CLAUDE_CODE_') && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'VIGIE_NODE'));

  // Plugins (décisions 034, 037) : le plugin répond (JSON d'une méthode) ou décrit un terminal ; le transport valide l'entrée, ouvre le PTY et répond.
  const plugins = createPlugins({ dir: pluginsDir, dataRoot: pluginsDataDir, baseEnv: cleanEnv, enabled: settings.plugins ?? {} });
  /** Erreur d'un plugin (marquée `status` : 400 message pour l'utilisateur, 404, 500, 504) → réponse JSON. */
  const pluginError = (res, e) => json(res, e.status ?? 500, { error: String(e?.message ?? e) });

  function spawnTerminal({ sessionId, kind, cwd, command, title }) {
    // SHELL manque quand le daemon tourne en service ; zsh est souvent absent sous Linux.
    const shell = process.env.SHELL || os.userInfo().shell || '/bin/sh';
    const id = crypto.randomUUID();
    const args = command ? ['-l', '-c', `${command}; exec ${shQuote(shell)} -l`] : ['-l'];
    const p = pty.spawn(shell, args, { name: 'xterm-256color', cols: 120, rows: 36, cwd, env: { ...cleanEnv, ...localeEnv({ platform, env: cleanEnv, locale: settings.locale }), TERM: 'xterm-256color', COLORTERM: 'truecolor' } });
    const term = { id, sessionId, kind, title: title ?? (kind === 'claude' ? 'claude' : path.basename(shell)), cwd, shell: `${shell} -l`, pid: p.pid, cols: 120, rows: 36, exited: false, startedAt: Date.now(), buf: '', clients: new Set(), p };
    p.onData((d) => {
      term.buf = (term.buf + d).slice(-SCROLLBACK);
      for (const ws of term.clients) ws.send(d);
    });
    // ponytail: un terminal terminé garde son tampon (512 Ko max) jusqu'à ce que l'UI le ferme, pour rejouer sa dernière sortie.
    // Suite : le réduire à la sortie, ou fermer les terminaux terminés depuis des heures, si la mémoire du daemon pèse.
    p.onExit(() => { term.exited = true; changed(); });
    terminals.set(id, term);
    changed();
    return term;
  }

  function closeTerminal(term) {
    if (!term.exited) term.p.kill();
    for (const ws of term.clients) ws.close();
    terminals.delete(term.id);
  }

  const publicTerm = ({ id, sessionId, kind, title, cwd, shell, pid, cols, rows, exited, startedAt }) => ({ id, sessionId, kind, title, cwd, shell, pid, cols, rows, exited, startedAt });
  const termList = () => [...terminals.values()].map(publicTerm);
  // Le statut de Claude est relevé par server.mjs (seul à sortir de la machine) ; le transport ne fait que le joindre.
  const snap = () => ({ ...store.snapshot(termList()), claudeStatus: claudeStatus(), plugins: plugins.active() });

  function startSession({ cwd, command }) {
    const dir = expandHome(String(cwd ?? ''), home);
    if (!dir || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Dossier introuvable : ${cwd}`);
    const { sessionId, command: cmd } = claudeCommand(command, hooksFile, crypto.randomUUID);
    return spawnTerminal({ sessionId, kind: 'claude', cwd: dir, command: cmd });
  }

  // ── Diffusion de l'état ─────────────────────────────────────────────────
  const watchers = new Set();
  let pending = null;
  function changed() {
    if (pending || !watchers.size) return; // personne n'écoute : pas de snapshot (un client reçoit le sien à la connexion)
    pending = setTimeout(() => {
      pending = null;
      // Callback de timer : une exception (store, plugin) y tuerait le daemon et tous les PTY.
      let msg;
      try { msg = JSON.stringify({ type: 'snapshot', ...snap() }); } catch (e) { return console.error('[vigie] snapshot impossible :', e); }
      for (const ws of watchers) ws.send(msg);
    }, 400);
    pending.unref(); // ne retient pas le processus (tests) ; le daemon vit par son serveur et ses intervalles
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  function json(res, code, body) {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function readBody(req, max = 1e6) {
    return new Promise((resolve, reject) => {
      let raw = '';
      // Erreurs marquées `status` : api() répond avec ce code au lieu d'un 500.
      const fail = (status, message) => reject(Object.assign(new Error(message), { status }));
      // Au-delà de `max` : on cesse d'accumuler et on draine sans garder (req.destroy() couperait le socket avant la 413).
      const onData = (d) => { raw += d; if (raw.length > max) { raw = ''; req.off('data', onData).resume(); fail(413, `Corps trop volumineux (${max / 1e6} Mo max)`); } };
      req.on('data', onData);
      req.on('error', () => fail(400, 'Corps illisible'));
      req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { fail(400, 'JSON invalide'); } });
    });
  }

  /** Réponse d'une lecture de session : 200 avec la valeur, 404 si la session est inconnue (valeur null). */
  const found = (res, value) => (value ? json(res, 200, value) : json(res, 404, { error: 'session inconnue' }));
  /** Dossier de la session, ou null après avoir répondu 404. */
  function sessionCwd(id, res) {
    const cwd = store.cwdOf(id, termList());
    if (!cwd) json(res, 404, { error: 'session inconnue' });
    return cwd;
  }
  /** Origine web étrangère (`Origin` ou `Sec-Fetch-Site`) : répond 403 et renvoie vrai. Tout GET /api/* et tout POST y passent. */
  function refused(req, res) {
    if (originOk(req) && siteOk(req)) return false;
    json(res, 403, { error: 'origine refusée' });
    return true;
  }

  /**
   * Claude au travail dans la session : il écrirait par-dessus (ou l'utilisateur par-dessus lui) ; on attend la fin du tour.
   * Répond 409 et renvoie vrai. Garde de toute route qui change un fichier de la session (git/write, git/restore, files/write).
   */
  function working(id, res) {
    if (store.idle(id, termList())) return false;
    json(res, 409, { error: 'Claude travaille dans cette session' });
    return true;
  }

  /** Corps validé par le schéma, ou null après avoir répondu 400. */
  function valid(schema, body, res) {
    const r = schema.safeParse(body);
    if (!r.success) json(res, 400, { error: r.error.issues[0]?.message ?? 'Requête invalide' });
    return r.success ? r.data : null;
  }
  /** Paramètres `q` et `case=1` d'une recherche (SearchQuery), ou null après avoir répondu 400. */
  const searchQuery = (url, res) => valid(SearchQuery, { q: url.searchParams.get('q'), case: url.searchParams.get('case') === '1' }, res);

  /**
   * Signal annulé quand la requête est abandonnée (onglet fermé, nouvelle frappe) : `close` suit aussi une réponse envoyée,
   * seule une réponse pas finie annule.
   */
  function abortOnClose(res) {
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    return ac.signal;
  }

  async function api(req, res, url) {
    const m = (re) => url.pathname.match(re);
    let r;
    // Tout GET : une page étrangère ne déclenche rien (git, lecture de fichier, outils des plugins), même sans `Origin`.
    if (req.method === 'GET' && refused(req, res)) return;
    if (req.method === 'GET' && url.pathname === '/api/snapshot') return json(res, 200, snap());
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)$/))) {
      const d = store.detail(r[1], termList());
      return found(res, d);
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const days = url.searchParams.get('days');
      const q = valid(UsageQuery, { days: days === null ? 14 : Number(days) }, res);
      return q && json(res, 200, store.usageRows(Date.now(), q.days));
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/cost$/))) {
      const cost = store.sessionCost(r[1]);
      return found(res, cost);
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/trace$/))) {
      const trace = store.sessionTrace(r[1], termList());
      return found(res, trace);
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/config$/))) {
      const cwd = sessionCwd(r[1], res);
      return cwd && json(res, 200, readClaudeConfig(cwd, home, managedSettingsFile(platform)));
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/git$/))) {
      const cwd = sessionCwd(r[1], res);
      return cwd && json(res, 200, await readGitDiff(cwd));
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/git\/file$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const q = valid(FileQuery, { path: url.searchParams.get('path') }, res);
      if (!q) return;
      try { return json(res, 200, await readWorktreeFile(cwd, q.path)); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    // Explorateur de fichiers : lecture de n'importe quel fichier du projet (.env compris).
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/files(\/read)?$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      if (!r[2]) return json(res, 200, await listProjectFiles(cwd));
      const q = valid(FileQuery, { path: url.searchParams.get('path') }, res);
      if (!q) return;
      try { return json(res, 200, await readProjectFile(cwd, q.path)); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    // Recherche texte : renvoie des extraits de fichiers.
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/files\/search$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const q = searchQuery(url, res);
      if (!q) return;
      // Requête abandonnée : la recherche s'arrête au fichier suivant.
      try { return json(res, 200, await searchProjectFiles(cwd, q.q, { matchCase: q.case, signal: abortOnClose(res) })); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    // Recherche dans les sessions du snapshot (palette ⌘F) : titres et journaux, par le cache du journal du store.
    if (req.method === 'GET' && url.pathname === '/api/search') {
      const q = searchQuery(url, res);
      if (!q) return;
      const out = await store.searchSessions(q.q, termList(), { matchCase: q.case, signal: abortOnClose(res) });
      return out && json(res, 200, out); // null : requête abandonnée, plus personne à qui répondre
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/log$/))) {
      const since = url.searchParams.get('since');
      const q = valid(LogQuery, { since: since === null ? 0 : Number(since) }, res);
      return q && found(res, store.sessionLog(r[1], q.since));
    }
    // Sélecteur de projet : chemin tapé → ses sous-dossiers, sinon les dossiers récents (projects.listProjects ; sonde le disque).
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const q = valid(ProjectsQuery, { q: url.searchParams.get('q') ?? '' }, res);
      return q && json(res, 200, await listProjects(q.q, home, store.recentDirs()));
    }
    // Plugins : un plugin lance des outils (detect compris).
    if (req.method === 'GET' && url.pathname === '/api/plugins') return json(res, 200, plugins.list());
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/plugins$/))) {
      const cwd = sessionCwd(r[1], res);
      return cwd && json(res, 200, await plugins.detect(cwd));
    }
    if (req.method === 'GET' && url.pathname === '/api/settings') return json(res, 200, settingsView());
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
    if (refused(req, res)) return;
    // Paramètres tolérés (`; charset=utf-8`, envoyé par certains clients dont les hooks HTTP) : reste hors des requêtes « simples », donc préflight CORS.
    if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(res, 415, { error: 'JSON attendu' });
    let body;
    // Hooks : PostToolUse d'un Edit ou d'un Write embarque le fichier entier (tool_response), d'où une limite plus haute.
    try { body = await readBody(req, url.pathname === '/api/hook' ? 16e6 : 1e6); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }

    if (url.pathname === '/api/hook') {
      // Hook HTTP de Claude Code : même spool que hook.mjs, lu par server.mjs (rejeu au démarrage compris). Aucun process lancé.
      // Inactive : hooks.json branche des hooks en commande (décision 021) ; gardée pour les réactiver (cf. server.mjs).
      const b = valid(HookEvent, body, res);
      if (!b) return;
      if (spoolFile) await fs.promises.appendFile(spoolFile, JSON.stringify(spoolLine(b)) + '\n');
      return json(res, 200, {});
    }
    if (url.pathname === '/api/settings') {
      const b = valid(SettingsBody, body, res);
      if (!b) return;
      if (b.locale && !(await localeKnown(b.locale))) return json(res, 400, { error: `Locale « ${b.locale} » non installée sur ce système (voir \`locale -a\`) : le terminal retomberait en C et les accents seraient cassés.` });
      try { saveSettings({ ...settings, ...b }); } catch (e) { return json(res, 500, { error: `Réglages non enregistrés : ${e.message}` }); }
      return json(res, 200, settingsView());
    }
    if ((r = m(/^\/api\/plugins\/([a-z0-9-]+)$/))) {
      const b = valid(PluginToggleBody, body, res);
      if (!b) return;
      let info;
      try { info = await plugins.setEnabled(r[1], b.enabled); } catch (e) { return pluginError(res, e); }
      // Écrit après le chargement réussi ; un échec d'écriture annule le changement (pas d'état actif mais oublié au redémarrage).
      try { saveSettings({ ...settings, plugins: { ...settings.plugins, [r[1]]: b.enabled } }); } catch (e) {
        await plugins.setEnabled(r[1], !b.enabled).catch(() => {});
        return json(res, 500, { error: `Réglages non enregistrés : ${e.message}` });
      }
      changed();
      return json(res, 200, info);
    }
    // Méthode d'un plugin : une lecture, mais en POST (origine, content-type JSON et préflight déjà en place ; params en JSON libre).
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/plugins\/([a-z0-9-]+)\/call\/([\w-]+)$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const b = valid(PluginCallBody, body, res);
      if (!b) return;
      // Requête abandonnée : le signal du handler est annulé, son outil (vigie.exec) tué.
      try { return json(res, 200, await plugins.call(r[2], r[3], cwd, b.params, { signal: abortOnClose(res) })); } catch (e) { return pluginError(res, e); }
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/plugins\/([a-z0-9-]+)\/actions\/([\w-]+)$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const b = valid(PluginActionBody, body, res);
      if (!b) return;
      let out;
      try { out = await plugins.action(r[2], r[3], cwd, b); } catch (e) { return pluginError(res, e); }
      // Le plugin a seulement décrit le terminal (argv quoté par le SDK) : seul le transport ouvre le PTY, avec l'env normal des terminaux.
      return json(res, 201, { terminal: publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd, command: out.terminal.command, title: out.terminal.title })) });
    }
    if (url.pathname === '/api/sessions') {
      const b = valid(NewSessionBody, body, res);
      if (!b) return;
      try { return json(res, 201, publicTerm(startSession(b))); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // Routes sans paramètre : corps `{}` seulement (rien de l'UI n'est ignoré sans avoir été décrit).
    const empty = /^\/api\/(chat(\/[\w-]+\/delete)?|sessions\/[\w-]+\/(delete|git\/commit-message)|terminals\/[\w-]+\/close)$/.test(url.pathname);
    if (empty && !valid(EmptyBody, body, res)) return;
    if (url.pathname === '/api/chat') {
      // Commande fixée ici, pas par l'UI : une discussion reste toujours en mode plan.
      return json(res, 201, publicTerm(startSession({ cwd: chatDir, command: 'claude --permission-mode plan' })));
    }
    if ((r = m(/^\/api\/chat\/([\w-]+)\/delete$/))) {
      const id = r[1];
      // Garde-fou : seule une discussion (dossier chatDir) est effacée du disque (purge le revérifie, 2ᵉ passe comprise).
      if (!store.isChat(id, termList())) return json(res, 403, { error: 'pas une discussion' });
      for (const term of [...terminals.values()].filter((t) => t.sessionId === id)) closeTerminal(term);
      store.purge(id);
      // claude peut encore écrire son transcript en quittant : deuxième passe un peu plus tard (purge ne lève pas ; try : callback de timer).
      setTimeout(() => { try { store.purge(id); changed(); } catch (e) { console.error(`[vigie] deuxième passe de la discussion ${id} :`, e); } }, 3000).unref();
      changed();
      return json(res, 200, { ok: true });
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/delete$/))) {
      // Ferme les terminaux de la session (claude compris) puis la retire de Vigie.
      for (const term of [...terminals.values()].filter((t) => t.sessionId === r[1])) closeTerminal(term);
      store.hide(r[1]);
      changed();
      return json(res, 200, { ok: true });
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/terminals$/))) {
      // Voulu, différent de store.cwdOf : un nouveau shell s'ouvre là où tourne déjà un terminal de la session (même un shell),
      // y compris une session qui n'a plus que ses shells ; le transcript ne sert qu'à défaut.
      const cwd = termList().find((x) => x.sessionId === r[1])?.cwd ?? store.cwdOf(r[1], []);
      if (!cwd) return json(res, 404, { error: 'session inconnue' });
      const b = valid(TerminalBody, body, res);
      if (!b) return;
      return json(res, 201, publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd })));
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/git\/(restore|commit|commit-message|branch|write)$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      if ((r[2] === 'write' || r[2] === 'restore') && working(r[1], res)) return;
      try {
        if (r[2] === 'write') {
          const b = valid(WriteBody, body, res);
          if (b) { await writeWorktreeFile(cwd, b.path, b.content, b.hash, home); json(res, 200, { ok: true }); }
          return;
        }
        if (r[2] === 'restore') {
          const b = valid(RestoreBody, body, res);
          if (b) { await restoreFile(cwd, b.path, home); json(res, 200, { ok: true }); }
          return;
        }
        if (r[2] === 'branch') {
          const b = valid(BranchBody, body, res);
          if (b) { await createBranch(cwd, b.name, home); json(res, 200, { ok: true }); }
          return;
        }
        if (r[2] === 'commit') {
          const b = valid(CommitBody, body, res);
          if (b) { await commitAll(cwd, b.message, home); json(res, 200, { ok: true }); }
          return;
        }
        // Onglet fermé pendant la rédaction (claude -p, plusieurs secondes) : claude est tué.
        return json(res, 200, { message: await suggestCommitMessage(cwd, cleanEnv, { workDir: commitDir, signal: abortOnClose(res) }) });
      } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/files\/write$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      if (working(r[1], res)) return;
      const b = valid(WriteBody, body, res);
      if (!b) return;
      try { await writeProjectFile(cwd, b.path, b.content, b.hash, home); return json(res, 200, { ok: true }); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    if ((r = m(/^\/api\/terminals\/([\w-]+)\/input$/))) {
      const term = terminals.get(r[1]);
      if (!term || term.exited) return json(res, 404, { error: 'terminal fermé' });
      const b = valid(InputBody, body, res);
      if (!b) return;
      term.p.write(b.data);
      return json(res, 200, { ok: true });
    }
    if ((r = m(/^\/api\/terminals\/([\w-]+)\/close$/))) {
      const term = terminals.get(r[1]);
      if (!term) return json(res, 404, { error: 'terminal inconnu' });
      closeTerminal(term);
      changed();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = http.createServer(async (req, res) => {
    // Une requête malformée (URL ou chemin indécodable…) ne doit pas faire tomber le daemon.
    try {
      // Contrôle d'hôte avant tout, statiques compris : bloque le DNS rebinding.
      if (!hostOk(req.headers.host, port)) return json(res, 403, { error: 'hôte refusé' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        try { return await api(req, res, url); } catch (e) { return json(res, 500, { error: String(e?.message ?? e) }); }
      }
      // UI : fichiers statiques, repli sur index.html pour le routeur Angular.
      let file = staticFile(uiDir, url.pathname);
      if (file === null) { res.writeHead(400); return res.end(); }
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) file = path.join(uiDir, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(503); return res.end('UI non construite : lance `npm run build`.'); }
        // CSP sur tout fichier de l'UI (décision 044) : la page, et un worker éventuel, qui prend la politique de sa propre réponse.
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP });
        res.end(data);
      });
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });

  // ── WebSocket : /ws (état) et /pty/<id> (un terminal) ───────────────────
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    // Listener synchrone : une exception ici tuerait le daemon.
    try {
      const url = new URL(req.url, 'http://localhost');
      const termMatch = url.pathname.match(/^\/pty\/([\w-]+)$/);
      const term = termMatch && terminals.get(termMatch[1]);
      if (!hostOk(req.headers.host, port) || !originOk(req) || (url.pathname !== '/ws' && !term)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (!term) {
          watchers.add(ws);
          ws.on('error', () => {}); // sans écouteur, une trame invalide fait lever 'error' hors de tout try ; la fermeture suit via 'close'
          ws.send(JSON.stringify({ type: 'snapshot', ...snap() }));
          ws.on('close', () => watchers.delete(ws));
          return;
        }
        ws.send(term.buf); // rejeu du buffer : l'UI se rattache au terminal en cours
        term.clients.add(ws);
        ws.on('error', () => {}); // sans écouteur, une trame invalide fait lever 'error' hors de tout try ; la fermeture suit via 'close'
        ws.on('message', (raw) => {
          let parsed;
          try { parsed = PtyMessage.safeParse(JSON.parse(raw)); } catch { return; }
          if (!parsed.success || term.exited) return; // message invalide : ignoré
          const msg = parsed.data;
          // Écouteur hors de tout try : une erreur node-pty (PTY fermé entre-temps…) tuerait le daemon.
          try {
            if (msg.type === 'input') term.p.write(msg.data);
            if (msg.type === 'resize') {
              term.p.resize(msg.cols, msg.rows);
              term.cols = msg.cols; term.rows = msg.rows;
              changed();
            }
          } catch (e) { console.error(`pty ${term.id} :`, e?.message ?? e); }
        });
        ws.on('close', () => term.clients.delete(ws));
      });
    } catch { socket.destroy(); }
  });

  return { server, changed };
}
