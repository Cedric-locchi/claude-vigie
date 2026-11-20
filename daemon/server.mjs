// Point d'entrée du daemon Vigie (launchd, bin/vigie.mjs et l'app Electron pointent sur ce fichier) : construit le store,
// branche le transport (transport.mjs), écoute sur 127.0.0.1, puis seulement prépare ~/.vigie. Ne pas importer : il démarre tout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createTransport } from './transport.mjs';
import { hooksSettings, nodeCommand } from './launch.mjs';
import { batchWatch, readNewLines } from './ingest.mjs';
import { claudeConfigDir } from './paths.mjs';
import { findOnPath, nodeVersionOk } from './platform.mjs';
import { fetchStatus } from './claude-status.mjs';
import { killAll } from './plugins.mjs';
import { killAll as killGit } from './git.mjs';

const PORT = Number(process.env.VIGIE_PORT ?? 4317);
// Serveur de dev Angular (ng serve) accepté seulement sur demande : VIGIE_DEV=1.
const DEV = process.env.VIGIE_DEV === '1';
const HOME = os.homedir();
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UI_DIR = path.join(ROOT, 'ui', 'dist', 'ui', 'browser');
const PROJECTS = path.join(claudeConfigDir({ env: process.env, home: HOME }), 'projects');
const VIGIE_DIR = path.join(HOME, '.vigie');
const SPOOL = path.join(VIGIE_DIR, 'spool.jsonl');
const HOOKS_FILE = path.join(VIGIE_DIR, 'hooks.json');
/** Dossier vide des discussions : Claude sans projet, en mode plan (lecture seule). */
const CHAT_DIR = path.join(VIGIE_DIR, 'chat');

// Sous Node 24, une promesse rejetée que personne n'attend tue le process : un plugin (ou un adaptateur) ne doit pas faire tomber le daemon.
process.on('unhandledRejection', (e) => console.error('[vigie] rejet non géré :', e));
// ponytail: une exception synchrone d'un plugin (dans un timer, un émetteur sans écouteur `error`) tue encore le daemon ; acceptable
// tant que les plugins sont livrés avec Vigie (pas de `uncaughtException` global, qui laisserait tourner un état incohérent).
// Suite : un utilityProcess / worker par plugin si des plugins tiers arrivent.

// Arrêt (launchd, systemd, Ctrl-C, Electron qui quitte) : les outils des plugins, git et claude -p (groupes détachés) ne survivent pas au daemon.
// Le signal est relevé une fois le ménage fait : l'arrêt reste celui par défaut (même code de sortie).
const stopChildren = () => { killAll(); killGit(); };
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { stopChildren(); process.kill(process.pid, sig); });
process.on('exit', stopChildren);

// Commande node des scripts lancés par Claude Code (logique dans launch.nodeCommand ; ici, les accès disque et `node --version`).
// Dans l'app, l'utilityProcess a pour execPath le binaire « Helper » : l'app passe le sien (VIGIE_NODE).
const isExecutable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };
// Verdict `node --version` par binaire (chemin + date) : le recalcul périodique ne relance pas node tant qu'il n'a pas changé.
const versionVerdict = new Map();
function versionOk(file) {
  let key;
  try { key = `${file}:${fs.statSync(file).mtimeMs}`; } catch { return false; }
  if (!versionVerdict.has(key)) {
    let ok = false;
    try { ok = nodeVersionOk(execFileSync(file, ['--version'], { encoding: 'utf8', timeout: 3000 })); } catch { /* node cassé : repli */ }
    versionVerdict.set(key, ok);
  }
  return versionVerdict.get(key);
}
const pathNode = () => { const f = findOnPath('node', { env: process.env, isExecutable }); return f && versionOk(f) ? f : null; };
const currentNode = () => nodeCommand({ electron: !!process.versions.electron, execPath: process.execPath, execOk: isExecutable(process.execPath), vigieNode: process.env.VIGIE_NODE, pathNode });
// Scripts lancés par Claude Code : pris hors de l'archive asar de l'app (asarUnpack), comme de simples fichiers.
const SCRIPTS = path.join(ROOT.replace(/app\.asar$/, 'app.asar.unpacked'), 'daemon');
// Réécrit hooks.json seulement si la commande change : Claude Code le relit à chaque lancement de session, pas en cours de route.
let NODE = null;
function writeHooks() {
  const node = currentNode();
  if (node === NODE) return;
  NODE = node;
  // Hooks en commande (décision 021) : un `node hook.mjs` par événement. Tous les événements dont deriveState a besoin
  // (UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, SessionEnd) sont dans hooksSettings.
  // ponytail: hooks HTTP coupés, le proxy du sandbox Claude Code (souvent imposé à distance, donc indétectable ici) les refuse en 403.
  // Suite : les réactiver quand Claude Code les sort du proxy ou qu'on sait détecter le sandbox de façon fiable (httpHooksAllowed, /api/hook restent en place).
  fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooksSettings(NODE, SCRIPTS, null), null, 2));
}

// ── Store et transport : rien n'est écrit avant `listen` ──────────────────
// Un second daemon (systemd relance toutes les 2 s, launchd KeepAlive) échoue sur le port : il ne doit ni purger les
// discussions vivantes du premier, ni faire tourner son spool, ni réécrire hooks.json. createStore et createTransport ne font
// que lire (seule exception : un usage.json illisible est mis de côté, ce que le premier daemon a déjà fait au sien).
const store = createStore({ projectsDir: PROJECTS, hiddenFile: path.join(VIGIE_DIR, 'hidden.json'), chatDir: CHAT_DIR, limitsDir: path.join(VIGIE_DIR, 'limits'), historyFile: path.join(VIGIE_DIR, 'usage.json') });
let claudeStatus; // absent du snapshot jusqu'au premier relevé
const { server, changed } = createTransport({ store, port: PORT, uiDir: UI_DIR, home: HOME, platform: process.platform, chatDir: CHAT_DIR, hooksFile: HOOKS_FILE, settingsFile: path.join(VIGIE_DIR, 'settings.json'), pluginsDir: path.join(ROOT, 'plugins'), pluginsDataDir: path.join(VIGIE_DIR, 'plugins-data'), commitDir: path.join(VIGIE_DIR, 'commit-message'), spoolFile: SPOOL, dev: DEV, claudeStatus: () => claudeStatus });

/** Callback de timer ou de watcher : une exception y tuerait le daemon et tous ses PTY ; on la journalise et on continue. */
const guarded = (label, fn) => (...args) => { try { fn(...args); } catch (e) { console.error(`[vigie] ${label} :`, e); } };

// Avant `listen` (port pris, EACCES) : sortie sans rien toucher. Après (EMFILE sur un accept…) : le serveur écoute toujours,
// sortir tuerait tous les PTY ; on journalise et on continue.
server.on('error', (e) => {
  if (server.listening) return console.error('[vigie] erreur du serveur HTTP :', e);
  console.error(e.code === 'EADDRINUSE'
    ? `[vigie] port ${PORT} déjà pris (un autre daemon Vigie tourne ? \`vigie status\`) : arrêt, rien n'a été modifié.`
    : `[vigie] écoute impossible sur 127.0.0.1:${PORT} : ${e.message}`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[vigie] http://127.0.0.1:${PORT}`);
  fs.mkdirSync(CHAT_DIR, { recursive: true });
  writeHooks();
  // Un node qui change ou disparaît (nvm, mise, brew) pendant que le daemon tourne : les sessions lancées ensuite visent le bon.
  // ponytail: les sessions déjà ouvertes gardent l'ancien chemin (Claude Code lit --settings une fois) ; PATH du daemon lu au démarrage.
  setInterval(guarded('hooks.json non réécrit', writeHooks), 60_000);

  const t0 = Date.now();
  store.scan();
  // Historique avant la purge des discussions : leur consommation y reste, sans leur texte.
  store.saveHistory();
  store.purgeChats();
  // Un transcript effacé pendant que le daemon tourne garde sa consommation : store.scan enregistre l'historique avant d'oublier une piste disparue.
  // ponytail: seul un transcript effacé daemon éteint, ou après un arrêt brutal, perd la consommation postérieure au dernier enregistrement (10 min au plus).
  setInterval(guarded('historique', () => store.saveHistory()), 10 * 60_000);
  console.log(`[vigie] ${store.tracks.size} transcripts indexés en ${Date.now() - t0} ms`);

  // Le spool ne sert qu'à l'état temps réel (dernier événement par session) : le `.old` n'est jamais relu, l'écraser ne perd rien.
  // ponytail: spool lu en entier au démarrage, rotation simple au-delà de 20 Mo (au démarrage seulement : un daemon qui tourne des semaines le laisse grossir).
  try { if (fs.statSync(SPOOL).size > 20 * 1024 * 1024) fs.renameSync(SPOOL, SPOOL + '.old'); } catch { /* pas encore de spool */ }
  // Même lecture incrémentale que les transcripts (ingest.readNewLines) : jamais d'exception, remise à zéro si le fichier raccourcit.
  const spool = { file: SPOOL, offset: 0, rest: '' };
  const readSpool = () => readNewLines(spool, (o) => store.onHook(o), () => Object.assign(spool, { offset: 0, rest: '' }));
  readSpool();

  // ── Rafraîchissements ──
  // fs.watch nomme le fichier touché : seuls ces transcripts sont relus (store.scanFiles) ; sans nom, scan complet.
  // Regroupement par ingest.batchWatch (250 ms après le premier événement, noms accumulés).
  const scheduleScan = batchWatch(PROJECTS, guarded('scan des transcripts', ({ files, full }) => { if (full ? store.scan() : store.scanFiles(files)) changed(); }));
  // Erreur asynchrone du watcher (inotify ENOSPC, dossier supprimé) : sans écouteur, elle tuerait le daemon ; le scan de 5 s continue.
  try { fs.watch(PROJECTS, { recursive: true }, guarded('watcher', scheduleScan)).on('error', (e) => console.error(`[vigie] surveillance de ${PROJECTS} arrêtée (${e.code ?? e.message}) : relecture toutes les 5 s seulement`)); } catch { /* repli sur le polling */ }
  // ponytail: scan complet synchrone (readdir + stat de chaque transcript des 14 derniers jours) toutes les 5 s, pour les suppressions,
  // déplacements et événements perdus. Suite : l'espacer si des milliers de transcripts le rendent sensible.
  setInterval(guarded('scan complet', () => { if (store.scan()) changed(); }), 5000);
  setInterval(guarded('spool', () => { if (readSpool()) changed(); }), 500);
  setInterval(guarded('snapshot périodique', changed), 15_000); // les états dépendent du temps (en cours → terminé)

  // Statut de Claude (décision 024) : fetchStatus ne rejette jamais, un échec donne 'unknown'.
  const refreshStatus = async () => { claudeStatus = await fetchStatus(); changed(); };
  refreshStatus();
  // fetchStatus ne rejette jamais ; une exception de changed() après l'await finirait en rejet journalisé (unhandledRejection).
  setInterval(guarded('statut de Claude', refreshStatus), 5 * 60_000);
});
