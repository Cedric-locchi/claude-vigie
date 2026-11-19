// Plugin Xcode (décision 030, porté en plugin par la 034) : conteneur et scripts du dossier d'une session, schemes et simulateurs,
// build / test / clean / run dans un terminal, ouverture dans Xcode.
// Frontière de plateforme par l'outil, jamais par `process.platform` : sans xcodebuild (Linux, ENOENT) ou avec les seuls
// Command Line Tools (« requires Xcode », « unable to find utility »), l'outil se déclare indisponible.
// N'importe rien de Vigie : le SDK arrive en argument (`vigie`), les schémas partagés avec le front sont dans ./contract.mjs.
// Écrit seulement dans vigie.dataDir (DerivedData).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPT, ScriptParams, XcodeCleanParams, XcodeProject, XcodeRunParams, XcodeTargets } from './contract.mjs';

const MAX_ERROR = 500;
const MAX_SCRIPTS = 100;
const CONTAINER = /^[\w .+-]+\.(xcworkspace|xcodeproj)$/;
const NO_XCODE = /requires Xcode|unable to find utility/i;

const cut = (s) => { const t = String(s).trim(); return t.length > MAX_ERROR ? t.slice(0, MAX_ERROR) + '…' : t; };

// ── Fonctions pures ─────────────────────────────────────────────────────

/** Conteneur Xcode parmi les noms à la racine : workspace, sinon projet, sinon paquet Swift, sinon null. */
export function pickContainer(names) {
  // ponytail: si plusieurs conteneurs du même type, le premier par ordre alphabétique gagne ; un choix dans l'UI si quelqu'un en a deux.
  // Nom ordinaire seulement : il finit dans un argv quoté, où un antislash est refusé.
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

/** DerivedData propre à Vigie et au dossier, sous le dataDir du plugin : ne touche jamais celui d'Xcode. */
export const derivedDataDir = (dataDir, cwd) => path.join(dataDir, crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 12));

// Lancé par `/bin/sh -c` : le PTY exécute `$SHELL -l -c`, et fish ne comprend pas `VAR=$(…)`. Pas de `set -e` : les `&&` suffisent.
// Le DerivedData est partagé entre les schemes du dossier : on retire d'abord les .app déjà là (ceux d'un autre scheme), sinon
// `find` pourrait lancer l'app d'hier. Les intermédiaires restent : seuls lien et copie du produit sont refaits. DD est à nous.
// ponytail: on suppose Debug-iphonesimulator (configuration et destination sont imposées ici, sauf SYMROOT personnalisé)
// et un seul .app par scheme ; sinon passer par `-showBuildSettings -json`.
// Sans antislash : vigie.terminal le refuserait.
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

/** argv d'une action Xcode (le SDK quote chaque argument). */
export function xcodeArgv({ action, scheme, udid, container, derivedData }) {
  const c = containerArgs(container);
  if (action === 'run') return ['/bin/sh', '-c', RUN_SCRIPT, 'vigie', scheme, udid, derivedData, ...c];
  const dest = action === 'clean' ? [] : ['-destination', `platform=iOS Simulator,id=${udid}`];
  return ['xcodebuild', ...c, '-scheme', scheme, ...dest, '-derivedDataPath', derivedData, action];
}

/** argv d'un script de scripts/ (nom déjà validé contre la liste relue). */
export const scriptArgv = (name) => [name.endsWith('.py') ? 'python3' : 'bash', path.join('scripts', name)];

// ── I/O (ne rejettent jamais) ───────────────────────────────────────────

/** `{ container, scripts }` du dossier : une readdir, plus celle de scripts/. Aucun process. */
export async function readProject(cwd) {
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

/** Schemes et simulateurs : `{ available, schemes, simulators, error }`. xcodebuild (30 s) et simctl (10 s) en parallèle. */
export async function readTargets(vigie, cwd, container, signal) {
  const none = { available: true, schemes: [], simulators: [] };
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return { ...none, error: 'dossier introuvable' };
  const [list, sims] = await Promise.all([
    vigie.exec(['xcodebuild', '-list', '-json', '-disableAutomaticPackageResolution', ...containerArgs(container)], { cwd, timeout: 30_000, signal }),
    vigie.exec(['xcrun', 'simctl', 'list', 'devices', 'available', '-j'], { cwd, timeout: 10_000, signal }),
  ]);
  for (const r of [list, sims]) {
    if (r.missing) return { available: false, schemes: [], simulators: [], error: null };
    if (!r.ok && NO_XCODE.test(r.stderr)) return { available: false, schemes: [], simulators: [], error: cut(r.stderr) };
  }
  const out = { ...none, error: null };
  const fail = (msg) => { out.error ??= msg; };
  if (list.timedOut) fail('xcodebuild ne répond pas');
  else if (!list.ok) fail(cut(list.stderr) || list.error);
  else try { out.schemes = parseSchemes(list.stdout); } catch { fail('sortie de xcodebuild illisible'); }
  if (sims.timedOut) fail('simctl ne répond pas');
  else if (!sims.ok) fail(cut(sims.stderr) || sims.error);
  else try { out.simulators = parseSimulators(sims.stdout); } catch { fail('sortie de simctl illisible'); }
  return out;
}

export default (vigie) => {
  /** Conteneur relu à l'instant (pas cru sur parole) ; sinon 400. */
  const container = async (cwd) => {
    const p = await readProject(cwd);
    if (!p.container) throw vigie.error('Pas un projet Xcode');
    return p;
  };

  // Le scheme n'est pas relu (xcodebuild -list est trop lent) : il passe la regex, puis le SDK le quote.
  const xcodeAction = (action) => ({
    params: action === 'clean' ? XcodeCleanParams : XcodeRunParams,
    async handler({ cwd, params }) {
      const p = await container(cwd);
      const argv = xcodeArgv({ action, scheme: params.scheme, udid: params.udid, container: p.container, derivedData: derivedDataDir(vigie.dataDir, cwd) });
      return vigie.terminal(argv, { title: `${action} ${params.scheme}` });
    },
  });

  return vigie.definePlugin({
    id: 'xcode',
    name: 'Xcode',
    session: {
      async detect({ cwd }) {
        return (await readProject(cwd)).container !== null;
      },
      methods: {
        // Rapide, sans process : conteneur et scripts.
        project: { result: XcodeProject, timeout: 10_000, handler: ({ cwd }) => readProject(cwd) },
        // Lent : xcodebuild -list (30 s) et simctl en parallèle. Sans conteneur : 400 « Pas un projet Xcode ».
        targets: {
          result: XcodeTargets,
          timeout: 45_000,
          async handler({ cwd, signal }) { return readTargets(vigie, cwd, (await container(cwd)).container, signal); },
        },
        // xed sans PTY : rien à montrer, la fenêtre d'Xcode s'ouvre.
        open: {
          result: vigie.z.null(),
          timeout: 10_000,
          async handler({ cwd, signal }) {
            const { container: c } = await container(cwd);
            const target = c.kind === 'package' ? cwd : path.join(cwd, c.name);
            // 8 s < délai de la méthode (10 s) : xed lent rend « xed ne répond pas », pas un 504 générique.
            const r = await vigie.exec(['xed', target], { cwd, timeout: 8000, signal });
            if (!r.ok) throw vigie.error(r.missing ? 'xed introuvable (Xcode absent ?)' : cut(r.stderr) || r.error);
            return null;
          },
        },
      },
      actions: {
        run: xcodeAction('run'),
        build: xcodeAction('build'),
        test: xcodeAction('test'),
        clean: xcodeAction('clean'),
        script: {
          params: ScriptParams,
          async handler({ cwd, params }) {
            // Liste relue à l'instant : fichier ordinaire (pas un lien), non caché.
            if (!(await readProject(cwd)).scripts.includes(params.name)) throw vigie.error('Script inconnu');
            return vigie.terminal(scriptArgv(params.name), { title: params.name });
          },
        },
      },
    },
  });
};
