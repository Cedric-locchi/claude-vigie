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
import { BranchBody, CommitBody, FileQuery, HookEvent, InputBody, NewSessionBody, PtyMessage, RestoreBody, SearchQuery, SettingsBody, TerminalBody, UsageQuery, WriteBody } from '../contract/index.mjs';
import { readClaudeConfig } from './claude-config.mjs';
import { listProjectFiles, readProjectFile, searchProjectFiles, writeProjectFile } from './files.mjs';
import { commitAll, createBranch, readGitDiff, readWorktreeFile, restoreFile, suggestCommitMessage, writeWorktreeFile } from './git.mjs';
import { hostOk, staticFile } from './guard.mjs';
import { readMiseTasks } from './mise.mjs';
import { childDirs, describeDirs } from './projects.mjs';
import { claudeCommand, shQuote, spoolLine } from './launch.mjs';
import { derivedDataDir, openInXcode, readXcodeProject, readXcodeTargets, scriptCommand, xcodeCommand } from './xcode.mjs';
import { defaultLocale, localeEnv } from './platform.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
const SCROLLBACK = 512 * 1024;

/**
 * `store` : createStore(…) ; `uiDir` : UI construite ; `home` : remplacé par `~` dans /api/projects ;
 * `chatDir` : dossier des discussions ; `hooksFile` : réglages passés à claude --settings ; `dev` : accepte ng serve (4200) ;
 * `settingsFile` : réglages du daemon (~/.vigie/settings.json), gardés en mémoire seulement s'il est absent ;
 * `spoolFile` : spool des hooks (~/.vigie/spool.jsonl), où POST /api/hook ajoute ce que Claude Code poste ;
 * `miseBin` : exécutable mise pour lister les tâches (injecté par les tests) ;
 * `xcodeBins` : exécutables xcodebuild / xcrun / xed ; `xcodeDir` : DerivedData de Vigie (~/.vigie/xcode).
 */
export function createTransport({ store, port, uiDir, home, chatDir, hooksFile, settingsFile = null, spoolFile = null, dev = false, miseBin = 'mise', xcodeBins = { xcodebuild: 'xcodebuild', xcrun: 'xcrun', xed: 'xed' }, xcodeDir = path.join(home, '.vigie', 'xcode'), claudeStatus = () => undefined }) {
  const ORIGINS = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(dev ? ['http://localhost:4200'] : [])]);
  const originOk = (req) => !req.headers.origin || ORIGINS.has(req.headers.origin);

  // ── Réglages ────────────────────────────────────────────────────────────
  // Fichier absent, illisible ou hors contrat (édité à la main) : réglages par défaut plutôt qu'une locale invalide dans les PTY.
  let settings = { locale: null };
  try { const r = SettingsBody.safeParse(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); if (r.success) settings = r.data; } catch { /* pas encore de réglages */ }
  const settingsView = () => ({
    locale: settings.locale ?? null,
    defaultLocale: defaultLocale({ platform: process.platform, env: cleanEnv }),
    alerts: settings.alerts ?? { dailyCost: null, windowPct: null },
  });
  /** Écrit puis applique : un échec d'écriture ne laisse pas une locale active mais oubliée au redémarrage ; tmp + rename, jamais de fichier tronqué. */
  function saveSettings(next) {
    if (settingsFile) {
      fs.writeFileSync(settingsFile + '.tmp', JSON.stringify(next, null, 2));
      fs.renameSync(settingsFile + '.tmp', settingsFile);
    }
    settings = next;
  }

  // ── Terminaux (PTY) ─────────────────────────────────────────────────────
  const terminals = new Map();
  // Les terminaux ne doivent hériter ni de la session Claude parente, ni des réglages internes de l'app.
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDECODE') && !k.startsWith('CLAUDE_CODE_') && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'VIGIE_NODE'));

  // Lecture des tâches mise : jamais de MISE_YES (pas d'approbation implicite), hors ligne (pas d'installation ni de téléchargement).
  const { MISE_YES: _yes, ...miseBase } = cleanEnv;
  const miseEnv = { ...miseBase, MISE_OFFLINE: '1', MISE_HIDE_UPDATE_WARNING: '1' };
  const miseTasks = (cwd) => readMiseTasks(cwd, { env: miseEnv, bin: miseBin, home });

  function spawnTerminal({ sessionId, kind, cwd, command, title }) {
    // SHELL manque quand le daemon tourne en service ; zsh est souvent absent sous Linux.
    const shell = process.env.SHELL || os.userInfo().shell || '/bin/sh';
    const id = crypto.randomUUID();
    const args = command ? ['-l', '-c', `${command}; exec ${shQuote(shell)} -l`] : ['-l'];
    const p = pty.spawn(shell, args, { name: 'xterm-256color', cols: 120, rows: 36, cwd, env: { ...cleanEnv, ...localeEnv({ platform: process.platform, env: cleanEnv, locale: settings.locale }), TERM: 'xterm-256color', COLORTERM: 'truecolor' } });
    const term = { id, sessionId, kind, title: title ?? (kind === 'claude' ? 'claude' : path.basename(shell)), cwd, shell: `${shell} -l`, pid: p.pid, cols: 120, rows: 36, exited: false, startedAt: Date.now(), buf: '', clients: new Set(), p };
    p.onData((d) => {
      term.buf = (term.buf + d).slice(-SCROLLBACK);
      for (const ws of term.clients) ws.send(d);
    });
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
  const snap = () => ({ ...store.snapshot(termList()), claudeStatus: claudeStatus() });

  function startSession({ cwd, command }) {
    const dir = String(cwd ?? '').replace(/^~(?=$|\/)/, home);
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
      const msg = JSON.stringify({ type: 'snapshot', ...snap() });
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
  /** Origine web étrangère : répond 403 et renvoie vrai (routes qui lisent le disque ou lancent un process, même en GET). */
  function refused(req, res) {
    if (originOk(req)) return false;
    json(res, 403, { error: 'origine refusée' });
    return true;
  }

  /** Corps validé par le schéma, ou null après avoir répondu 400. */
  function valid(schema, body, res) {
    const r = schema.safeParse(body);
    if (!r.success) json(res, 400, { error: r.error.issues[0]?.message ?? 'Requête invalide' });
    return r.success ? r.data : null;
  }

  async function api(req, res, url) {
    const m = (re) => url.pathname.match(re);
    let r;
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
      return cwd && json(res, 200, readClaudeConfig(cwd));
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/git$/))) {
      const cwd = sessionCwd(r[1], res);
      return cwd && json(res, 200, await readGitDiff(cwd));
    }
    // Origine contrôlée même en GET : lire une config mise approuvée peut exécuter ses templates.
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/mise$/))) {
      if (refused(req, res)) return;
      const cwd = sessionCwd(r[1], res);
      return cwd && json(res, 200, await miseTasks(cwd));
    }
    // Xcode : origine contrôlée, la route sonde le disque (et `targets` lance xcodebuild).
    // ponytail: pas de cache, l'UI garde la liste ; si l'onglet est rechargé souvent, une Map cwd → promesse.
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/xcode(\/targets)?$/))) {
      if (refused(req, res)) return;
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const project = await readXcodeProject(cwd);
      if (!r[2]) return json(res, 200, project);
      if (!project.container) return json(res, 200, { available: false, schemes: [], simulators: [], error: 'Pas un projet Xcode' });
      return json(res, 200, await readXcodeTargets(cwd, project.container, { env: cleanEnv, bins: xcodeBins }));
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/git\/file$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const q = valid(FileQuery, { path: url.searchParams.get('path') }, res);
      if (!q) return;
      try { return json(res, 200, await readWorktreeFile(cwd, q.path)); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    // Explorateur de fichiers : lecture de n'importe quel fichier du projet (.env compris), d'où le contrôle d'origine même en GET.
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/files(\/read)?$/))) {
      if (refused(req, res)) return;
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      if (!r[2]) return json(res, 200, await listProjectFiles(cwd));
      const q = valid(FileQuery, { path: url.searchParams.get('path') }, res);
      if (!q) return;
      try { return json(res, 200, await readProjectFile(cwd, q.path)); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    // Recherche texte : même contrôle d'origine que la lecture (renvoie des extraits de fichiers).
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/files\/search$/))) {
      if (refused(req, res)) return;
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const q = valid(SearchQuery, { q: url.searchParams.get('q'), case: url.searchParams.get('case') === '1' }, res);
      if (!q) return;
      // Onglet fermé ou nouvelle frappe : la requête est abandonnée, la recherche s'arrête au fichier suivant.
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      try { return json(res, 200, await searchProjectFiles(cwd, q.q, { matchCase: q.case, signal: ac.signal })); } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    if (req.method === 'GET' && (r = m(/^\/api\/sessions\/([\w-]+)\/log$/))) {
      const log = store.sessionLog(r[1], Number(url.searchParams.get('since')) || 0);
      return found(res, log);
    }
    // Sélecteur de projet : chemin tapé → ses sous-dossiers, sinon les dossiers récents. Origine contrôlée : la route sonde le disque.
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      if (refused(req, res)) return;
      const q = url.searchParams.get('q') ?? '';
      const recent = store.recentDirs();
      const dirs = q.includes(path.sep) ? await childDirs(q, home) : recent.map((r) => r.dir);
      const projects = await describeDirs(dirs, new Map(recent.map((r) => [r.dir, r.lastTs])));
      const tilde = (p) => (p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p);
      return json(res, 200, projects.map((p) => ({ ...p, path: tilde(p.path) })));
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
      const b = valid(HookEvent, body, res);
      if (!b) return;
      if (spoolFile) await fs.promises.appendFile(spoolFile, JSON.stringify(spoolLine(b)) + '\n');
      return json(res, 200, {});
    }
    if (url.pathname === '/api/settings') {
      const b = valid(SettingsBody, body, res);
      if (!b) return;
      try { saveSettings({ ...settings, ...b }); } catch (e) { return json(res, 500, { error: `Réglages non enregistrés : ${e.message}` }); }
      return json(res, 200, settingsView());
    }
    if (url.pathname === '/api/sessions') {
      const b = valid(NewSessionBody, body, res);
      if (!b) return;
      try { return json(res, 201, publicTerm(startSession(b))); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (url.pathname === '/api/chat') {
      // Commande fixée ici, pas par l'UI : une discussion reste toujours en mode plan.
      return json(res, 201, publicTerm(startSession({ cwd: chatDir, command: 'claude --permission-mode plan' })));
    }
    if ((r = m(/^\/api\/chat\/([\w-]+)\/delete$/))) {
      const id = r[1];
      // Garde-fou : seule une discussion (dossier chatDir) est effacée du disque.
      if (!store.isChat(id, termList())) return json(res, 403, { error: 'pas une discussion' });
      for (const term of [...terminals.values()].filter((t) => t.sessionId === id)) closeTerminal(term);
      store.purge(id);
      // claude peut encore écrire son transcript en quittant : deuxième passe un peu plus tard.
      setTimeout(() => { store.purge(id); changed(); }, 3000).unref();
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
      // Le terminal de la session (même un shell) prime sur le transcript.
      const cwd = termList().find((x) => x.sessionId === r[1])?.cwd ?? store.cwdOf(r[1], []);
      if (!cwd) return json(res, 404, { error: 'session inconnue' });
      const b = valid(TerminalBody, body, res);
      if (!b) return;
      if ([b.miseTask !== undefined, b.miseTrust, b.xcode, b.script].filter(Boolean).length > 1) return json(res, 400, { error: 'Une seule action à la fois' });
      // Xcode et scripts : conteneur et liste relus à l'instant ; le scheme n'est pas relu (xcodebuild -list est trop lent), il passe la regex du contrat puis shQuote.
      if (b.xcode || b.script !== undefined) {
        const project = await readXcodeProject(cwd);
        if (b.script !== undefined) {
          if (!project.scripts.includes(b.script)) return json(res, 400, { error: 'Script inconnu' });
          return json(res, 201, publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd, command: scriptCommand(b.script), title: b.script })));
        }
        if (!project.container) return json(res, 400, { error: 'Pas un projet Xcode' });
        const command = xcodeCommand({ ...b.xcode, container: project.container, derivedData: derivedDataDir(xcodeDir, cwd) });
        return json(res, 201, publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd, command, title: `${b.xcode.action} ${b.xcode.scheme}` })));
      }
      // C'est l'utilisateur qui clique : seul endroit où Vigie lance `mise trust`. L'env du PTY reste le sien (réseau permis).
      if (b.miseTrust) return json(res, 201, publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd, command: 'mise trust', title: 'mise trust' })));
      if (b.miseTask !== undefined) {
        // Seul un nom listé par mise passe (relu ici, pas cru sur parole) ; un nom en `-…` serait pris pour une option.
        // `mise run -- <nom>` ne convient pas : mise y lit le nom comme argument de la tâche par défaut.
        const task = (await miseTasks(cwd)).tasks.find((t) => t.name === b.miseTask || t.aliases.includes(b.miseTask));
        if (!task || task.name.startsWith('-')) return json(res, 400, { error: 'Tâche mise inconnue' });
        return json(res, 201, publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd, command: `mise run ${shQuote(task.name)}`, title: task.name })));
      }
      return json(res, 201, publicTerm(spawnTerminal({ sessionId: r[1], kind: 'shell', cwd })));
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/xcode\/open$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      const { container } = await readXcodeProject(cwd);
      if (!container) return json(res, 400, { error: 'Pas un projet Xcode' });
      const o = await openInXcode(cwd, container, { env: cleanEnv, bins: xcodeBins });
      return o.ok ? json(res, 200, { ok: true }) : json(res, 500, { error: o.error });
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/git\/(restore|commit|commit-message|branch|write)$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      try {
        if (r[2] === 'write') {
          // Claude au travail : il écrirait par-dessus (ou l'utilisateur par-dessus lui) ; on attend la fin du tour.
          if (!store.idle(r[1], termList())) return json(res, 409, { error: 'Claude travaille dans cette session' });
          const b = valid(WriteBody, body, res);
          if (b) { await writeWorktreeFile(cwd, b.path, b.content, b.hash, home); json(res, 200, { ok: true }); }
          return;
        }
        if (r[2] === 'restore') {
          const b = valid(RestoreBody, body, res);
          if (b) { await restoreFile(cwd, b.path); json(res, 200, { ok: true }); }
          return;
        }
        if (r[2] === 'branch') {
          const b = valid(BranchBody, body, res);
          if (b) { await createBranch(cwd, b.name); json(res, 200, { ok: true }); }
          return;
        }
        if (r[2] === 'commit') {
          const b = valid(CommitBody, body, res);
          if (b) { await commitAll(cwd, b.message); json(res, 200, { ok: true }); }
          return;
        }
        return json(res, 200, { message: await suggestCommitMessage(cwd, cleanEnv) });
      } catch (e) { return json(res, e.status ?? 400, { error: e.message }); }
    }
    if ((r = m(/^\/api\/sessions\/([\w-]+)\/files\/write$/))) {
      const cwd = sessionCwd(r[1], res);
      if (!cwd) return;
      // Même règle que git/write : on n'écrit pas pendant que Claude travaille.
      if (!store.idle(r[1], termList())) return json(res, 409, { error: 'Claude travaille dans cette session' });
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
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
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
