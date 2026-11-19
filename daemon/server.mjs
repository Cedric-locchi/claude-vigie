// Point d'entrée du daemon Vigie (launchd, bin/vigie.mjs et l'app Electron pointent sur ce fichier) : prépare ~/.vigie,
// construit le store, branche le transport (transport.mjs) et écoute sur 127.0.0.1. Ne pas importer : il démarre tout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createTransport } from './transport.mjs';
import { hooksSettings } from './launch.mjs';
import { findOnPath, nodeVersionOk } from './platform.mjs';
import { fetchStatus } from './claude-status.mjs';
import { killAll } from './plugins.mjs';

const PORT = Number(process.env.VIGIE_PORT ?? 4317);
// Serveur de dev Angular (ng serve) accepté seulement sur demande : VIGIE_DEV=1.
const DEV = process.env.VIGIE_DEV === '1';
const HOME = os.homedir();
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UI_DIR = path.join(ROOT, 'ui', 'dist', 'ui', 'browser');
const PROJECTS = path.join(HOME, '.claude', 'projects');
const VIGIE_DIR = path.join(HOME, '.vigie');
const SPOOL = path.join(VIGIE_DIR, 'spool.jsonl');
const HOOKS_FILE = path.join(VIGIE_DIR, 'hooks.json');
/** Dossier vide des discussions : Claude sans projet, en mode plan (lecture seule). */
const CHAT_DIR = path.join(VIGIE_DIR, 'chat');

fs.mkdirSync(CHAT_DIR, { recursive: true });

// Sous Node 24, une promesse rejetée que personne n'attend tue le process : un plugin (ou un adaptateur) ne doit pas faire tomber le daemon.
process.on('unhandledRejection', (e) => console.error('[vigie] rejet non géré :', e));
// ponytail: une exception synchrone d'un plugin (dans un timer, un émetteur sans écouteur `error`) tue encore le daemon ; acceptable
// tant que les plugins sont livrés avec Vigie (pas de `uncaughtException` global, qui laisserait tourner un état incohérent).
// Suite : un utilityProcess / worker par plugin si des plugins tiers arrivent.

// Arrêt (launchd, systemd, Ctrl-C) : les outils lancés par les plugins (groupes détachés) ne survivent pas au daemon.
// Le signal est relevé une fois le ménage fait : l'arrêt reste celui par défaut (même code de sortie).
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { killAll(); process.kill(process.pid, sig); });
process.on('exit', killAll);

// Commande node des scripts lancés par Claude Code (statusline à chaque rafraîchissement, hook de repli).
// Dans l'app Electron, process.execPath est le binaire Electron, lourd à démarrer à chaque fois : on préfère un vrai node
// du PATH (l'app a repris celui du shell de connexion avant de lancer le daemon). Sinon, Electron via ELECTRON_RUN_AS_NODE ;
// lancé par l'app dans un utilityProcess, execPath serait le binaire « Helper » : l'app passe le sien (VIGIE_NODE).
const isExecutable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };
// Verdict `node --version` par binaire (chemin + date) : le recalcul périodique ne relance pas node tant qu'il n'a pas changé.
const versionVerdict = new Map();
function pathNodeOk() {
  const found = findOnPath('node', { env: process.env, isExecutable });
  if (!found) return null;
  let key;
  try { key = `${found}:${fs.statSync(found).mtimeMs}`; } catch { return null; }
  if (!versionVerdict.has(key)) {
    let ok = false;
    try { ok = nodeVersionOk(execFileSync(found, ['--version'], { encoding: 'utf8', timeout: 3000 })); } catch { /* node cassé : repli */ }
    versionVerdict.set(key, ok);
  }
  return versionVerdict.get(key) ? found : null;
}
function nodeCommand() {
  // Hors Electron, le node qui fait tourner le daemon ; si son fichier a disparu (nvm, mise, brew), celui du PATH.
  if (!process.versions.electron) return JSON.stringify(isExecutable(process.execPath) ? process.execPath : (pathNodeOk() ?? process.execPath));
  const found = pathNodeOk();
  if (found) return JSON.stringify(found);
  return 'ELECTRON_RUN_AS_NODE=1 ' + JSON.stringify(process.env.VIGIE_NODE || process.execPath);
}
// Réécrit hooks.json seulement si la commande change : Claude Code le relit à chaque lancement de session, pas en cours de route.
let NODE = null;
function writeHooks() {
  const node = nodeCommand();
  if (node === NODE) return;
  NODE = node;
  fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooksSettings(NODE, SCRIPTS, null), null, 2));
}
// Scripts lancés par Claude Code : pris hors de l'archive asar de l'app (asarUnpack), comme de simples fichiers.
const SCRIPTS = path.join(ROOT.replace(/app\.asar$/, 'app.asar.unpacked'), 'daemon');
// Hooks : un process `node hook.mjs` par événement (décision 021).
// Tous les événements dont deriveState a besoin (UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop,
// SessionEnd) sont dans hooksSettings, en commande comme en HTTP : couper le HTTP coûte un process par événement, aucun état.
// ponytail: hooks HTTP coupés, le proxy du sandbox Claude Code (souvent imposé à distance, donc indétectable ici) les refuse en 403.
// Suite : les réactiver quand Claude Code les sort du proxy ou qu'on sait détecter le sandbox de façon fiable (httpHooksAllowed, /api/hook restent en place).
writeHooks();
// Un node qui change ou disparaît (nvm, mise, brew) pendant que le daemon tourne : les sessions lancées ensuite visent le bon.
// ponytail: les sessions déjà ouvertes gardent l'ancien chemin (Claude Code lit --settings une fois) ; PATH du daemon lu au démarrage.
setInterval(() => { try { writeHooks(); } catch (e) { console.error(`[vigie] hooks.json non réécrit : ${e.message}`); } }, 60_000);

// ── Store ─────────────────────────────────────────────────────────────────
const store = createStore({ projectsDir: PROJECTS, hiddenFile: path.join(VIGIE_DIR, 'hidden.json'), chatDir: CHAT_DIR, limitsDir: path.join(VIGIE_DIR, 'limits'), historyFile: path.join(VIGIE_DIR, 'usage.json') });
const t0 = Date.now();
store.scan();
// Historique avant la purge des discussions : leur consommation y reste, sans leur texte.
store.saveHistory();
store.purgeChats();
// Un transcript effacé pendant que le daemon tourne garde sa consommation : store.scan enregistre l'historique avant d'oublier une piste disparue.
// ponytail: seul un transcript effacé daemon éteint, ou après un arrêt brutal, perd la consommation postérieure au dernier enregistrement (10 min au plus).
setInterval(() => store.saveHistory(), 10 * 60_000);
console.log(`[vigie] ${store.tracks.size} transcripts indexés en ${Date.now() - t0} ms`);

// Le spool ne sert qu'à l'état temps réel (dernier événement par session) : le `.old` n'est jamais relu, l'écraser ne perd rien.
// ponytail: spool lu en entier au démarrage, rotation simple au-delà de 20 Mo (au démarrage seulement : un daemon qui tourne des semaines le laisse grossir).
try { if (fs.statSync(SPOOL).size > 20 * 1024 * 1024) fs.renameSync(SPOOL, SPOOL + '.old'); } catch { /* pas encore de spool */ }
let spoolOffset = 0, spoolRest = '';
function readSpool() {
  let size;
  try { size = fs.statSync(SPOOL).size; } catch { return false; }
  if (size <= spoolOffset) return false;
  const fd = fs.openSync(SPOOL, 'r');
  const buf = Buffer.alloc(size - spoolOffset);
  fs.readSync(fd, buf, 0, buf.length, spoolOffset);
  fs.closeSync(fd);
  spoolOffset = size;
  const lines = (spoolRest + buf.toString('utf8')).split('\n');
  spoolRest = lines.pop();
  for (const l of lines) { try { store.onHook(JSON.parse(l)); } catch { /* ligne illisible */ } }
  return true;
}
readSpool();

// ── Transport et rafraîchissements ────────────────────────────────────────
let claudeStatus; // absent du snapshot jusqu'au premier relevé
const { server, changed } = createTransport({ store, port: PORT, uiDir: UI_DIR, home: HOME, chatDir: CHAT_DIR, hooksFile: HOOKS_FILE, settingsFile: path.join(VIGIE_DIR, 'settings.json'), pluginsDir: path.join(ROOT, 'plugins'), pluginsDataDir: path.join(VIGIE_DIR, 'plugins-data'), spoolFile: SPOOL, dev: DEV, claudeStatus: () => claudeStatus });

let scanTimer = null;
const scheduleScan = () => { clearTimeout(scanTimer); scanTimer = setTimeout(() => store.scan() && changed(), 250); };
try { fs.watch(PROJECTS, { recursive: true }, scheduleScan); } catch { /* repli sur le polling */ }
setInterval(() => { if (store.scan()) changed(); }, 5000);
setInterval(() => { if (readSpool()) changed(); }, 500);
setInterval(changed, 15_000); // les états dépendent du temps (en cours → terminé)

// Statut de Claude (décision 024) : fetchStatus ne rejette jamais, un échec donne 'unknown'.
const refreshStatus = async () => { claudeStatus = await fetchStatus(); changed(); };
refreshStatus();
setInterval(refreshStatus, 5 * 60_000);

server.listen(PORT, '127.0.0.1', () => console.log(`[vigie] http://127.0.0.1:${PORT}`));
