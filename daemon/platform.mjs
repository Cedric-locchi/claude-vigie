// Point de plateforme unique (macOS, Linux, WSL) : tout ce qui diffère d'un OS à l'autre vit ici, en fonctions pures.
// Plateforme, release et environnement sont passés en argument : les tests simulent Linux / WSL depuis un Mac.
// Les effets (écrire le plist ou l'unité, lancer launchctl / systemctl / open) restent chez l'appelant (bin/vigie.mjs, electron).
import path from 'node:path';

/** WSL : un noyau Linux livré par Microsoft (release `…-microsoft-standard-WSL2`) ou la variable posée par WSL. */
export const isWsl = ({ platform, release = '', env = {} }) => platform === 'linux' && (!!env.WSL_DISTRO_NAME || /microsoft/i.test(release));

/** Réglages gérés par l'organisation (portée la plus forte de Claude Code), null si la plateforme n'en a pas. */
export function managedSettingsFile(platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  // Emplacement Linux (et WSL) d'après la documentation de Claude Code, pas vérifié sur une machine gérée.
  if (platform === 'linux') return '/etc/claude-code/managed-settings.json';
  return null;
}

/** Commandes à essayer, dans l'ordre, pour ouvrir une URL (l'URL est ajoutée en dernier argument). */
export function openUrlCommands({ platform, wsl }) {
  if (platform === 'darwin') return [['open']];
  // Sous WSL, xdg-open n'a souvent aucun navigateur : on passe au navigateur de Windows (wslu, sinon l'explorateur).
  if (wsl) return [['wslview'], ['explorer.exe'], ['xdg-open']];
  return [['xdg-open']];
}

/**
 * Premier exécutable `name` du PATH (comme `command -v`), null sinon. `isExecutable(fichier)` est l'accès disque, injecté.
 * Les entrées vides ou relatives sont ignorées : elles dépendraient du dossier courant de celui qui lance la commande.
 */
export function findOnPath(name, { env = {}, isExecutable }) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const file = path.join(dir, name);
    if (isExecutable(file)) return file;
  }
  return null;
}

/** Version de `node --version` (« v22.3.0 ») assez récente pour hook.mjs et statusline.mjs (ESM, imports `node:`). */
export const nodeVersionOk = (out) => Number(/^v(\d+)\./.exec(String(out).trim())?.[1]) >= 18;

/** L'app de bureau quitte quand sa dernière fenêtre se ferme, sauf sous macOS (elle reste dans le Dock, comme les apps du système). */
export const quitsWithLastWindow = ({ platform }) => platform !== 'darwin';

/**
 * Arguments de `$SHELL` pour lire le PATH et CLAUDE_CONFIG_DIR du shell de connexion (app lancée depuis le Finder ou le bureau,
 * environnement minimal). Valeurs encadrées d'octets nuls, qu'aucune variable d'environnement ne peut contenir : ce qu'un
 * .zshrc ou un .bash_logout affiche avant ou après est écarté par `parseLoginShellEnv`.
 */
export const LOGIN_SHELL_ENV_ARGS = ['-ilc', "printf '\\0%s\\0%s\\0' \"$PATH\" \"$CLAUDE_CONFIG_DIR\""];

/** Sortie de LOGIN_SHELL_ENV_ARGS → `{ PATH, configDir }` (vides si non définies) ; null si les délimiteurs manquent ou sont en trop. */
export function parseLoginShellEnv(out) {
  const parts = String(out).split('\0');
  return parts.length === 4 ? { PATH: parts[1], configDir: parts[2] } : null;
}

/** Gestionnaire de services pour `vigie install` ; null : aucun (WSL sans systemd), l'appelant explique les options. */
export function startupMethod({ platform, hasSystemd }) {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux' && hasSystemd) return 'systemd';
  return null;
}

/**
 * systemd --user utilisable : Linux démarré par systemd (WSL sans `[boot] systemd=true` ne l'est pas : pas de /run/systemd/system)
 * et bus utilisateur joignable. `exists(chemin)` et `userBus()` sont les effets, injectés ; appelés seulement sous Linux.
 */
export const hasSystemd = ({ platform, exists, userBus }) => platform === 'linux' && exists('/run/systemd/system') && userBus();

/** Agent launchd de l'utilisateur (macOS). */
export const launchAgentFile = ({ home, label }) => path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);

/** Label du service (launchd) : `vigie install`, `vigie uninstall`. */
export const SERVICE_LABEL = 'dev.vigie.daemon';
/**
 * Fichiers que `vigie install` peut avoir posés (agent launchd, unité systemd), sans branche par OS : l'appelant teste leur
 * présence. L'app refuse de démarrer tant que l'un existe (décision 050) : le service relancerait le daemon qu'elle arrête.
 */
export const serviceFiles = ({ home, env = {} }) => [launchAgentFile({ home, label: SERVICE_LABEL }), path.join(systemdUserDir({ env, home }), 'vigie.service')];

/** Explication de `vigie install` sans gestionnaire de services : les instructions de WSL seulement sous WSL. */
export function noServiceHelp({ platform, wsl }) {
  const profile = `Démarrer le daemon à l'ouverture d'un shell : ajouter à ~/.profile
       vigie start >/dev/null 2>&1
     (sans relance automatique s'il tombe).`;
  if (wsl) return `systemd utilisateur injoignable : WSL démarré sans systemd ? Deux options :
  1. Activer systemd dans WSL : ajouter dans /etc/wsl.conf
       [boot]
       systemd=true
     puis, côté Windows : wsl --shutdown ; rouvrir le terminal et relancer vigie install.
  2. ${profile}`;
  if (platform === 'linux') return `systemd utilisateur injoignable (lancé avec sudo, session sans bus comme SSH, ou système sans systemd ?).
  Relance vigie install depuis ta session graphique, ou :
  ${profile}`;
  return `Pas de gestionnaire de services pris en charge ici.
  ${profile}`;
}

/**
 * Locale des terminaux : lancé par launchd, systemd ou le Finder (Electron), le daemon n'a ni LANG ni LC_* ;
 * le shell et claude tournent alors en locale C et cassent accents et symboles. Rien n'est forcé si l'utilisateur a choisi une locale.
 * C.UTF-8 n'existe pas sous macOS ; en_US.UTF-8 n'est pas toujours générée sous Linux.
 */
export function localeEnv({ platform, env = {}, locale = null }) {
  // Choix fait dans Vigie : prime sur l'environnement hérité.
  // La locale choisie est vérifiée à l'enregistrement (`localeInstalled`, transport.mjs) ; une locale désinstallée depuis ferait
  // retomber le shell en C. ponytail: `C.UTF-8` par défaut : absent des glibc < 2.35 sans paquet.
  if (locale) return { LANG: locale, LC_ALL: locale };
  if (env.LC_ALL || env.LC_CTYPE || env.LANG) return {};
  return { LANG: platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8' };
}

/**
 * `name` figure-t-elle dans la sortie de `locale -a` ? Casse et tirets du codeset ignorés : macOS écrit `fr_FR.UTF-8`,
 * glibc `fr_FR.utf8`, et les deux se comparent égaux. Le modificateur (`@euro`) reste significatif.
 */
export function localeInstalled(name, listing) {
  const norm = (s) => s.trim().toLowerCase().replace(/-/g, '');
  const want = norm(name);
  return String(listing).split('\n').some((l) => l.trim() && norm(l) === want);
}

/** Locale effective des terminaux sans choix dans Vigie (affichée dans les réglages). */
export const defaultLocale = ({ platform, env = {} }) => env.LC_ALL || env.LC_CTYPE || env.LANG || localeEnv({ platform }).LANG;

/** Dossier des unités systemd de l'utilisateur. */
export const systemdUserDir = ({ env = {}, home }) => path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user');

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Agent launchd : démarre le daemon à la connexion et le relance s'il tombe. `configDir` : CLAUDE_CONFIG_DIR de `vigie install`
 * (absent : le daemon lit ~/.claude), sans quoi un dossier posé dans le profil du shell manquerait au service.
 */
export function launchdPlist({ label, node, server, path: PATH, shell, log, configDir = null }) {
  const [l, n, s, p, sh, lg] = [label, node, server, PATH, shell, log].map(xml);
  const cfg = configDir ? `<key>CLAUDE_CONFIG_DIR</key><string>${xml(configDir)}</string>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${l}</string>
  <key>ProgramArguments</key><array><string>${n}</string><string>${s}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${p}</string><key>SHELL</key><string>${sh}</string>${cfg}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${lg}</string>
  <key>StandardErrorPath</key><string>${lg}</string>
</dict></plist>
`;
}

// Valeur entre guillemets pour une unité systemd : échappements C (\ et "), `%` est un spécificateur (%%),
// `$` est développé dans ExecStart ($$). Pas de saut de ligne possible dans un chemin ou un PATH raisonnable.
const unitQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
const execQuote = (s) => unitQuote(s).replace(/\$/g, '$$$$');

/** Unité systemd --user : équivalent du plist (démarrage à la connexion, relance si le daemon tombe, `configDir` compris). */
// StartLimitIntervalSec=0 : si le port est déjà pris (daemon lancé par `vigie start` ou l'app), on réessaie indéfiniment
// comme launchd, au lieu de passer en failed pour toujours après 5 échecs en 10 s. (L'app, elle, refuse de démarrer tant que
// le service est installé : `serviceFiles`, décision 050.)
export function systemdUnit({ node, server, path: PATH, shell, log, configDir = null }) {
  return `[Unit]
Description=Vigie, daemon de monitoring des sessions Claude Code
StartLimitIntervalSec=0

[Service]
ExecStart=${execQuote(node)} ${execQuote(server)}
Environment=${unitQuote(`PATH=${PATH}`)}
${shell ? `Environment=${unitQuote(`SHELL=${shell}`)}\n` : ''}${configDir ? `Environment=${unitQuote(`CLAUDE_CONFIG_DIR=${configDir}`)}\n` : ''}Restart=always
RestartSec=2
StandardOutput=append:${String(log).replace(/%/g, '%%')}
StandardError=append:${String(log).replace(/%/g, '%%')}

[Install]
WantedBy=default.target
`;
}
