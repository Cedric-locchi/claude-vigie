// Adaptateur Xcode : conteneur et scripts du dossier d'une session, schemes et simulateurs, commandes lancées dans un PTY.
// Frontière de plateforme par l'outil, jamais par `process.platform` : sans xcodebuild (Linux, ENOENT) ou avec les seuls
// Command Line Tools (« requires Xcode », « unable to find utility »), l'outil se déclare indisponible.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { shQuote } from './launch.mjs';

const MAX_ERROR = 500;
const MAX_SCRIPTS = 100;
const SCRIPT = /^[\w.-]+\.(sh|py)$/;
const CONTAINER = /^[\w .+-]+\.(xcworkspace|xcodeproj)$/;
const NO_XCODE = /requires Xcode|unable to find utility/i;

// ── Fonctions pures ─────────────────────────────────────────────────────

/** Conteneur Xcode parmi les noms à la racine : workspace, sinon projet, sinon paquet Swift, sinon null. */
export function pickContainer(names) {
  // ponytail: si plusieurs conteneurs du même type, le premier par ordre alphabétique gagne ; un choix dans l'UI si quelqu'un en a deux.
  // Nom ordinaire seulement : il finit quoté dans `$SHELL -c`, où un `\'` casserait le quotage sous fish.
  const sorted = [...names].sort().filter((n) => n === 'Package.swift' || CONTAINER.test(n));
  const ws = sorted.find((n) => n.endsWith('.xcworkspace'));
  if (ws) return { kind: 'workspace', name: ws };
  const proj = sorted.find((n) => n.endsWith('.xcodeproj'));
  if (proj) return { kind: 'project', name: proj };
  return sorted.includes('Package.swift') ? { kind: 'package', name: 'Package.swift' } : null;
}

/** Arguments xcodebuild qui désignent le conteneur ; un paquet Swift se trouve tout seul dans le cwd. */
export const containerArgs = (c) => (c.kind === 'workspace' ? ['-workspace', c.name] : c.kind === 'project' ? ['-project', c.name] : []);

/** Sortie de `xcodebuild -list -json` → schemes. Lève si le JSON est illisible. */
export function parseSchemes(stdout) {
  const s = String(stdout);
  // xcodebuild écrit parfois des avertissements avant le JSON.
  const j = JSON.parse(s.slice(s.indexOf('{')));
  const schemes = j?.workspace?.schemes ?? j?.project?.schemes ?? [];
  return Array.isArray(schemes) ? schemes.filter((x) => typeof x === 'string') : [];
}

/** Sortie de `xcrun simctl list devices available -j` → simulateurs iOS disponibles, runtime le plus récent d'abord. */
export function parseSimulators(stdout) {
  // ponytail: watchOS, tvOS et visionOS exclus ; à ajouter si l'onglet sert à d'autres cibles qu'iOS.
  const out = [];
  for (const [key, list] of Object.entries(JSON.parse(stdout)?.devices ?? {})) {
    const m = key.match(/SimRuntime\.iOS-([\d-]+)$/);
    if (!m || !Array.isArray(list)) continue;
    const runtime = `iOS ${m[1].replace(/-/g, '.')}`;
    for (const d of list) {
      if (!d || d.isAvailable === false || typeof d.udid !== 'string' || typeof d.name !== 'string') continue;
      out.push({ udid: d.udid, name: d.name, runtime, booted: d.state === 'Booted' });
    }
  }
  return out.sort((a, b) => b.runtime.localeCompare(a.runtime, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** DerivedData propre à Vigie et au dossier : ne touche jamais celui d'Xcode. */
export const derivedDataDir = (xcodeDir, cwd) => path.join(xcodeDir, crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 12));

// Lancé par `/bin/sh -c` : le PTY exécute `$SHELL -l -c`, et fish ne comprend pas `VAR=$(…)`. Pas de `set -e` : les `&&` suffisent.
// Le DerivedData est partagé entre les schemes du dossier : on retire d'abord les .app déjà là (ceux d'un autre scheme), sinon
// `find` pourrait lancer l'app d'hier. Les intermédiaires restent : seuls lien et copie du produit sont refaits. DD est à nous.
// ponytail: on suppose Debug-iphonesimulator (configuration et destination sont imposées ici, sauf SYMROOT personnalisé)
// et un seul .app par scheme ; sinon passer par `-showBuildSettings -json`.
export const CLEAN_APPS = 'rm -rf "$DD/Build/Products/Debug-iphonesimulator"/*.app';
export const RUN_SCRIPT = `S=$1 U=$2 DD=$3; shift 3
${CLEAN_APPS}
xcodebuild "$@" -scheme "$S" -configuration Debug -destination "platform=iOS Simulator,id=$U" -derivedDataPath "$DD" build &&
APP=$(find "$DD/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -n 1) &&
{ [ -n "$APP" ] || { echo "Aucune app construite par ce scheme"; false; }; } &&
BID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist") &&
{ xcrun simctl boot "$U" 2>/dev/null; true; } && open -a Simulator &&
xcrun simctl bootstatus "$U" -b && xcrun simctl install "$U" "$APP" &&
xcrun simctl launch --console-pty --terminate-running-process "$U" "$BID"`;

/** Commande shell d'une action Xcode ; toute valeur venue de l'UI passe par shQuote. */
export function xcodeCommand({ action, scheme, udid, container, derivedData }) {
  const c = containerArgs(container).map((a, i) => (i ? shQuote(a) : a)); // option fixe, nom quoté
  if (action === 'run') return ['/bin/sh', '-c', shQuote(RUN_SCRIPT), 'vigie', shQuote(scheme), shQuote(udid), shQuote(derivedData), ...c].join(' ');
  const dest = action === 'clean' ? [] : ['-destination', shQuote(`platform=iOS Simulator,id=${udid}`)];
  return ['xcodebuild', ...c, '-scheme', shQuote(scheme), ...dest, '-derivedDataPath', shQuote(derivedData), action].join(' ');
}

/** Commande d'un script de scripts/ (nom déjà validé contre la liste). */
export const scriptCommand = (name) => `${name.endsWith('.py') ? 'python3' : 'bash'} ${shQuote(path.join('scripts', name))}`;

// ── I/O (ne rejettent jamais) ───────────────────────────────────────────

/** `{ container, scripts }` du dossier : une readdir, plus celle de scripts/. Aucun process. */
export async function readXcodeProject(cwd) {
  let container;
  try { container = pickContainer(await fs.promises.readdir(cwd)); } catch { return { container: null, scripts: [] }; }
  const scripts = [];
  try {
    const dir = path.join(cwd, 'scripts');
    for (const name of (await fs.promises.readdir(dir)).sort()) {
      if (scripts.length >= MAX_SCRIPTS) break;
      if (name.startsWith('.') || !SCRIPT.test(name)) continue;
      // lstat : un lien pourrait mener hors du projet.
      if ((await fs.promises.lstat(path.join(dir, name)).catch(() => null))?.isFile()) scripts.push(name);
    }
  } catch { /* pas de scripts/ */ }
  return { container, scripts };
}

const MAX_BUFFER = 8 * 1024 * 1024;

/** spawn sans shell, stdin fermé ; résout toujours `{ err, stdout, stderr }` (forme d'execFile).
 * Groupe de processus à part (`detached`) : timeout et dépassement tuent aussi les petits-enfants (POSIX, macOS et Linux). */
function run(bin, args, { cwd, env, timeout }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { return resolve({ err, stdout: '', stderr: '' }); }
    const out = { stdout: [], stderr: [] };
    let size = 0, killed = false, overflow = false, done = false;
    const kill = () => {
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* déjà mort */ } }
    };
    const timer = setTimeout(kill, timeout);
    for (const k of ['stdout', 'stderr']) child[k].on('data', (b) => {
      size += b.length;
      if (size > MAX_BUFFER) { if (!overflow) { overflow = true; kill(); } return; }
      out[k].push(b);
    });
    const finish = (err, code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out.stdout).toString(), stderr = Buffer.concat(out.stderr).toString();
      if (!err && overflow) err = Object.assign(new Error('maxBuffer dépassé'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
      if (!err && (code !== 0 || signal)) err = Object.assign(new Error(`${bin} : code ${code ?? signal}`), { code, killed, signal });
      resolve({ err: err ?? null, stdout, stderr });
    };
    child.on('error', (err) => finish(err)); // ENOENT : err.code === 'ENOENT'
    child.on('close', (code, signal) => finish(null, code, signal));
  });
}

const cut = (s) => { const t = String(s).trim(); return t.length > MAX_ERROR ? t.slice(0, MAX_ERROR) + '…' : t; };
const timedOut = (err) => err && err.killed && err.signal === 'SIGKILL' && typeof err.code !== 'string';

/** Schemes et simulateurs : `XcodeTargets`. `bins` injectables pour les tests. */
export async function readXcodeTargets(cwd, container, { env = process.env, bins = {}, timeouts = {} } = {}) {
  const { xcodebuild = 'xcodebuild', xcrun = 'xcrun' } = bins;
  const none = { available: true, schemes: [], simulators: [] };
  // Un cwd disparu ferait lever ENOENT au spawn, pris pour « pas de Xcode ».
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return { ...none, error: 'dossier introuvable' };
  const [list, sims] = await Promise.all([
    run(xcodebuild, ['-list', '-json', '-disableAutomaticPackageResolution', ...containerArgs(container)], { cwd, env, timeout: timeouts.list ?? 30_000 }),
    run(xcrun, ['simctl', 'list', 'devices', 'available', '-j'], { cwd, env, timeout: timeouts.simctl ?? 10_000 }),
  ]);
  for (const r of [list, sims]) {
    if (r.err?.code === 'ENOENT') return { available: false, schemes: [], simulators: [], error: null };
    if (r.err && NO_XCODE.test(r.stderr)) return { available: false, schemes: [], simulators: [], error: cut(r.stderr) };
  }
  const out = { ...none, error: null };
  const fail = (msg) => { out.error ??= msg; };
  if (timedOut(list.err)) fail('xcodebuild ne répond pas');
  else if (list.err) fail(cut(list.stderr) || list.err.message);
  else try { out.schemes = parseSchemes(list.stdout); } catch { fail('sortie de xcodebuild illisible'); }
  if (timedOut(sims.err)) fail('simctl ne répond pas');
  else if (sims.err) fail(cut(sims.stderr) || sims.err.message);
  else try { out.simulators = parseSimulators(sims.stdout); } catch { fail('sortie de simctl illisible'); }
  return out;
}

/** Ouvre le conteneur dans Xcode (`xed`), sans PTY : `{ ok, error }`. */
export async function openInXcode(cwd, container, { env = process.env, bins = {} } = {}) {
  const target = container.kind === 'package' ? cwd : path.join(cwd, container.name);
  const r = await run(bins.xed ?? 'xed', [target], { cwd, env, timeout: 10_000 });
  if (!r.err) return { ok: true, error: null };
  return { ok: false, error: r.err.code === 'ENOENT' ? 'xed introuvable (Xcode absent ?)' : cut(r.stderr) || r.err.message };
}
