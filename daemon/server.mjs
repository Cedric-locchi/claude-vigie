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

// Commande node des scripts lancés par Claude Code (statusline à chaque rafraîchissement, hook de repli).
// Dans l'app Electron, process.execPath est le binaire Electron, lourd à démarrer à chaque fois : on préfère un vrai node
// du PATH (l'app a repris celui du shell de connexion avant de lancer le daemon). Sinon, Electron via ELECTRON_RUN_AS_NODE ;
// lancé par l'app dans un utilityProcess, execPath serait le binaire « Helper » : l'app passe le sien (VIGIE_NODE).
function nodeCommand() {
  if (!process.versions.electron) return JSON.stringify(process.execPath);
  const isExecutable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };
  const found = findOnPath('node', { env: process.env, isExecutable });
  // ponytail: version lue une fois au démarrage ; un node du PATH changé ensuite (nvm, mise) n'est revu qu'au redémarrage du daemon.
  try { if (found && nodeVersionOk(execFileSync(found, ['--version'], { encoding: 'utf8', timeout: 3000 }))) return JSON.stringify(found); } catch { /* node cassé : repli */ }
  return 'ELECTRON_RUN_AS_NODE=1 ' + JSON.stringify(process.env.VIGIE_NODE || process.execPath);
}
const NODE = nodeCommand();
// Scripts lancés par Claude Code : pris hors de l'archive asar de l'app (asarUnpack), comme de simples fichiers.
const SCRIPTS = path.join(ROOT.replace(/app\.asar$/, 'app.asar.unpacked'), 'daemon');
// Hooks : un process `node hook.mjs` par événement (décision 021).
// ponytail: hooks HTTP coupés, le proxy du sandbox Claude Code (souvent imposé à distance, donc indétectable ici) les refuse en 403.
// Suite : les réactiver quand Claude Code les sort du proxy ou qu'on sait détecter le sandbox de façon fiable (httpHooksAllowed, /api/hook restent en place).
fs.writeFileSync(HOOKS_FILE, JSON.stringify(hooksSettings(NODE, SCRIPTS, null), null, 2));

// ── Store ─────────────────────────────────────────────────────────────────
const store = createStore({ projectsDir: PROJECTS, hiddenFile: path.join(VIGIE_DIR, 'hidden.json'), chatDir: CHAT_DIR, limitsDir: path.join(VIGIE_DIR, 'limits'), historyFile: path.join(VIGIE_DIR, 'usage.json') });
const t0 = Date.now();
store.scan();
// Historique avant la purge des discussions : leur consommation y reste, sans leur texte.
store.saveHistory();
store.purgeChats();
// ponytail: un transcript effacé (par Claude ou à la main) entre deux enregistrements emporte au plus 10 min de consommation.
setInterval(() => store.saveHistory(), 10 * 60_000);
console.log(`[vigie] ${store.tracks.size} transcripts indexés en ${Date.now() - t0} ms`);

// ponytail: spool lu en entier au démarrage, rotation simple au-delà de 20 Mo.
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
const { server, changed } = createTransport({ store, port: PORT, uiDir: UI_DIR, home: HOME, chatDir: CHAT_DIR, hooksFile: HOOKS_FILE, settingsFile: path.join(VIGIE_DIR, 'settings.json'), xcodeDir: path.join(VIGIE_DIR, 'xcode'), spoolFile: SPOOL, dev: DEV, claudeStatus: () => claudeStatus });

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
