#!/usr/bin/env node
// vigie            → démarre le daemon s'il ne tourne pas, puis ouvre l'UI dans le navigateur
// vigie start      → démarre le daemon (détaché) s'il ne tourne pas, sans ouvrir l'UI
// vigie status     → conso et agents en attente, dans le terminal
// vigie install    → service (launchd sur macOS, systemd --user sous Linux) : le daemon démarre à la connexion
//                    et redémarre s'il tombe ; sans systemd (WSL), explique les options sans rien modifier
// vigie uninstall  → retire ce service
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Snapshot } from '../contract/index.mjs';
import { claudeConfigDir } from '../daemon/paths.mjs';
import { hasSystemd, isWsl, launchdPlist, noServiceHelp, openUrlCommands, SERVICE_LABEL as LABEL, serviceFiles, startupMethod, systemdUnit } from '../daemon/platform.mjs';

const PORT = Number(process.env.VIGIE_PORT ?? 4317);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER = path.join(ROOT, 'daemon', 'server.mjs');
const LOG = path.join(os.homedir(), '.vigie', 'daemon.log');

const snapshot = () => fetch(`${ORIGIN}/api/snapshot`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
const WSL = isWsl({ platform: process.platform, release: os.release(), env: process.env });
const alive = () => snapshot().then(() => true, () => false);
const pct = (r) => `${Math.round(r * 100)} %`;

async function start() {
  if (await alive()) return true;
  const log = fs.openSync(LOG, 'a');
  spawn(process.execPath, [SERVER], { detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 40; i++) {
    if (await alive()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`Le daemon ne répond pas sur le port ${PORT}. Voir ${LOG}.`);
  return false;
}

/** Première commande disponible de la plateforme ; aucune (ou échec) → on affiche l'URL. */
function openUrl(url) {
  for (const [cmd, ...args] of openUrlCommands({ platform: process.platform, wsl: WSL })) {
    try {
      execFileSync(cmd, [...args, url], { stdio: 'ignore', timeout: 10_000 });
      return;
    } catch (e) {
      if (e.code !== 'ENOENT') break; // ponytail: explorer.exe sort en 1 même quand il a ouvert ; l'URL affichée en plus est sans gravité
    }
  }
  console.log(`Ouvre ${url} dans ton navigateur.`);
}

async function open() {
  if (await start()) openUrl(ORIGIN);
  else process.exitCode = 1;
}

async function status() {
  const raw = await snapshot().catch(() => undefined);
  if (raw === undefined) return console.log('Daemon arrêté. Lance `vigie`.');
  // Même contrat que l'UI : un daemon d'une autre version ne fait pas planter la commande sur un champ manquant.
  const parsed = Snapshot.safeParse(raw);
  if (!parsed.success) { process.exitCode = 1; return console.error('Réponse inattendue du daemon : est-il à jour ? (redémarre-le après une mise à jour)'); }
  const s = parsed.data;
  const w = s.usage.window;
  console.log(`Fenêtre 5 h : ${w.active ? pct(w.pct) : '—'}${w.real ? '' : ' (estimation)'}${w.weekPct != null ? ` · semaine ${pct(w.weekPct)}` : ''}`);
  const waiting = s.sessions.filter((x) => x.state === 'waiting' || x.state === 'turn');
  const running = s.sessions.filter((x) => x.state === 'running');
  console.log(`${running.length} en cours · ${waiting.length} attendent ta réponse`);
  for (const x of waiting) console.log(`  ● ${x.project} · ${x.title}${x.detail ? ` — ${x.detail}` : ''}`);
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const tryRun = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };

// Chemins et tests propres à l'OS dans platform.mjs ; ici, seulement les effets (existsSync, systemctl).
const systemd = () => hasSystemd({ platform: process.platform, exists: fs.existsSync, userBus: () => tryRun('systemctl', ['--user', 'show-environment']) });
const method = () => startupMethod({ platform: process.platform, hasSystemd: systemd() });
const [PLIST, UNIT] = serviceFiles({ home: os.homedir(), env: process.env });

function install() {
  // PATH, SHELL et CLAUDE_CONFIG_DIR (s'il est défini, résolu comme le daemon le résout) du moment de l'installation : lancé par
  // launchd / systemd, le daemon n'a pas l'environnement du shell et lirait ~/.claude au lieu du dossier choisi. Une variable
  // changée ensuite demande de relancer `vigie install`.
  const configDir = process.env.CLAUDE_CONFIG_DIR ? claudeConfigDir({ env: process.env, home: os.homedir() }) : null;
  const service = { label: LABEL, node: process.execPath, server: SERVER, path: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', log: LOG, configDir };
  const m = method();
  if (m === 'launchd') {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(PLIST, launchdPlist({ ...service, shell: process.env.SHELL ?? '/bin/zsh' }));
    tryRun('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]); // pas encore chargé : sans importance
    run('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST]);
    console.log(`Daemon installé (${PLIST}). Désinstaller : vigie uninstall`);
  } else if (m === 'systemd') {
    fs.mkdirSync(path.dirname(UNIT), { recursive: true });
    fs.writeFileSync(UNIT, systemdUnit({ ...service, shell: process.env.SHELL || os.userInfo().shell }));
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', 'vigie.service']);
    // restart et pas `enable --now` : sur une réinstallation, l'ancienne unité tournerait encore.
    run('systemctl', ['--user', 'restart', 'vigie.service']);
    console.log(`Daemon installé (${UNIT}). Journal : ${LOG}. Désinstaller : vigie uninstall`);
  } else {
    // Aucun gestionnaire de services : on ne touche à aucun dotfile, on explique (WSL : comment y activer systemd).
    console.log(noServiceHelp({ platform: process.platform, wsl: WSL }));
  }
}

function uninstall() {
  const m = method();
  if (m === 'launchd') {
    tryRun('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]);
    fs.rmSync(PLIST, { force: true });
    console.log('Daemon désinstallé (agent launchd retiré).');
  } else if (m === 'systemd') {
    tryRun('systemctl', ['--user', 'disable', '--now', 'vigie.service']);
    fs.rmSync(UNIT, { force: true });
    run('systemctl', ['--user', 'daemon-reload']);
    console.log('Daemon désinstallé (unité systemd retirée).');
  } else {
    console.log('Aucun service installé. Si tu as ajouté `vigie start` à ~/.profile, retire la ligne.');
  }
}

fs.mkdirSync(path.join(os.homedir(), '.vigie'), { recursive: true });
const cmd = process.argv[2];
if (cmd === 'status') await status();
else if (cmd === 'start') process.exitCode = (await start()) ? 0 : 1;
else if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else if (!cmd) await open();
else console.log('Usage : vigie [start|status|install|uninstall]');
