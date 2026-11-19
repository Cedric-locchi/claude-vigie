// App Electron : ouvre la fenêtre tout de suite, réutilise le daemon s'il tourne déjà (`vigie install`, `vigie start`, `npm start`),
// sinon le lance dans un utilityProcess (process Node séparé : le process principal reste libre pour la fenêtre).
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, utilityProcess } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWsl, openUrlCommands } from '../daemon/platform.mjs';

const PORT = Number(process.env.VIGIE_PORT ?? 4317);
const URL = `http://127.0.0.1:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAEMON = path.join(HERE, '..', 'daemon', 'server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sous WSL, shell.openExternal passe par xdg-open, souvent sans navigateur : on vise celui de Windows.
const WSL = isWsl({ platform: process.platform, release: os.release(), env: process.env });
function openExternal(url) {
  if (!WSL) return void shell.openExternal(url);
  const [first, ...rest] = openUrlCommands({ platform: process.platform, wsl: true });
  const attempt = ([cmd, ...args], next) => execFile(cmd, [...args, url], (err) => {
    if (err?.code !== 'ENOENT') return;
    if (next.length) attempt(next[0], next.slice(1));
    else console.error(`Aucun navigateur trouvé : ouvre ${url}`);
  });
  attempt(first, rest);
}
const alive = () => fetch(`${URL}/api/snapshot`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

// Lancée depuis le Finder, l'app hérite d'un PATH minimal : on reprend celui du shell de connexion (pour trouver `claude`).
// Asynchrone : ça ne retarde ni la fenêtre ni la détection du daemon. SIGKILL : un shell interactif ignore SIGTERM.
process.env.SHELL ||= os.userInfo().shell;
const pathReady = new Promise((resolve) => {
  execFile(process.env.SHELL, ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' }, (err, out) => {
    if (!err && out) process.env.PATH = out;
    resolve();
  });
});

let win = null;
let daemon = null;
let ready = false;
let quitting = false;

/** Page d'attente affichée pendant que le daemon démarre, aux couleurs du thème système. */
const splash = (message) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta name="color-scheme" content="dark light">
<style>body{margin:0;height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;background:#0b1214;color:#a8b3b6}
@media (prefers-color-scheme:light){body{background:#fcfcfc;color:#4c585a}}</style><p>${message}</p>`);

function open() {
  win = new BrowserWindow({
    width: 1400, height: 900, title: 'Vigie', show: false,
    autoHideMenuBar: true, // Linux : pas de barre de menus Electron par défaut (Alt l'affiche) ; sans effet sur macOS
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1214' : '#fcfcfc', // --bg des deux thèmes (ui/src/styles.css)
    // Le son « une session a besoin de toi » doit pouvoir jouer sans clic préalable dans la fenêtre.
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', preload: path.join(HERE, 'preload.cjs') },
  });
  win.once('ready-to-show', () => win.show());
  // Permissions (notifications « une session a besoin de toi », presse-papiers…) : accordées à l'UI de Vigie,
  // refusées à toute autre origine (Electron, par défaut, accorde tout à tout le monde).
  const ours = (url) => typeof url === 'string' && url.startsWith(URL);
  win.webContents.session.setPermissionRequestHandler((wc, _permission, done) => done(ours(wc.getURL())));
  win.webContents.session.setPermissionCheckHandler((_wc, _permission, origin) => ours(origin));
  win.on('closed', () => { win = null; });
  // Fenêtres de l'app (terminal détaché) : dans l'app ; tout le reste : dans le navigateur.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  // La fenêtre ne quitte jamais l'UI de Vigie : un lien externe suivi dans la page part dans le navigateur.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(URL)) return;
    e.preventDefault();
    openExternal(url);
  });
  win.loadURL(ready ? URL : splash('Démarrage de Vigie…'));
}

// Sélecteur de dossier natif (champ Dossier de « Nouvelle session »). Un projet iOS (.xcodeproj / .xcworkspace, paquets
// que le Finder montre comme des fichiers) ou un fichier choisi donne son dossier parent. Réservé à l'UI de Vigie.
const IOS_CONTAINER = /\.(xcodeproj|xcworkspace)$/;
ipcMain.handle('vigie:pick-folder', async (e, from) => {
  if (!e.senderFrame?.url.startsWith(URL)) return null;
  const start = typeof from === 'string' && from ? from.replace(/^~(?=$|\/)/, os.homedir()) : os.homedir();
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Choisis le dossier du projet', buttonLabel: 'Choisir', defaultPath: start,
    // openFile en plus : sur macOS, permet de choisir un .xcodeproj ; ailleurs, la combinaison donne un sélecteur de dossier.
    properties: ['openDirectory', 'openFile', 'createDirectory'],
  });
  const picked = r.canceled ? null : r.filePaths[0];
  if (!picked) return null;
  const isDir = fs.statSync(picked, { throwIfNoEntry: false })?.isDirectory() ?? false;
  return IOS_CONTAINER.test(picked) || !isDir ? path.dirname(picked) : picked;
});

async function startDaemon() {
  if (await alive()) return true;
  await pathReady; // les terminaux du daemon doivent trouver `claude`
  // ponytail: le daemon embarqué meurt avec l'app (et ses PTY) ; on prévient avant de quitter (confirmQuit). Pour qu'ils survivent, `vigie install` (launchd / systemd --user).
  daemon = utilityProcess.fork(DAEMON, [], {
    serviceName: 'Vigie daemon',
    stdio: 'inherit',
    // Binaire de l'app, pour les hooks de Claude Code (dans l'utilityProcess, execPath serait le « Helper »).
    env: { ...process.env, VIGIE_NODE: process.execPath },
  });
  daemon.on('exit', (code) => {
    daemon = null;
    if (!quitting) console.error(`[vigie] daemon arrêté (code ${code})`);
  });
  for (let i = 0; i < 60; i++) {
    if (await alive()) return true;
    if (!daemon) return false; // planté au démarrage (port pris, module natif…)
    await sleep(250);
  }
  return false;
}

// Quitter tue le daemon embarqué et donc ses terminaux (claude, scripts, builds) : on demande confirmation s'il en reste de vivants.
// Daemon injoignable ou réponse illisible : on ne bloque pas la sortie.
async function confirmQuit() {
  const terms = await fetch(`${URL}/api/snapshot`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()).then((j) => j.terminals, () => []);
  const n = Array.isArray(terms) ? terms.filter((t) => t && t.exited === false).length : 0;
  if (!n) return true;
  const { response } = await dialog.showMessageBox({
    type: 'warning', buttons: ['Annuler', 'Quitter'], defaultId: 0, cancelId: 0, title: 'Quitter Vigie ?',
    message: n === 1 ? 'Un terminal est encore en cours.' : `${n} terminaux sont encore en cours.`,
    detail: 'Quitter Vigie les arrête, claude compris. Pour qu\'ils survivent à l\'app, installe le service avec `vigie install`.',
  });
  return response === 1;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let confirmed = false;
  let asking = false;
  app.on('before-quit', (e) => {
    // Pas de daemon à nous (celui d'un service) : rien ne meurt avec l'app, pas de question.
    if (!daemon || confirmed) { quitting = true; daemon?.kill(); return; }
    e.preventDefault();
    if (asking) return;
    asking = true;
    confirmQuit().then((ok) => { asking = false; if (ok) { confirmed = true; app.quit(); } });
  });

  // Pas de top-level await : avec une entrée ESM, Electron n'émet `ready` qu'une fois le module évalué → deadlock.
  app.whenReady().then(async () => {
    open(); // fenêtre tout de suite, sur la page d'attente
    ready = await startDaemon();
    if (ready) win?.loadURL(URL);
    else win?.loadURL(splash(`Le daemon Vigie ne répond pas sur le port ${PORT}. Regarde la sortie de l'app, ou ~/.vigie/daemon.log s'il tourne en service (vigie install).`));
  });
}
