import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { localeInstalled, defaultLocale, findOnPath, hasSystemd, isWsl, launchAgentFile, LOGIN_SHELL_ENV_ARGS, nodeVersionOk, launchdPlist, localeEnv, managedSettingsFile, noServiceHelp, openUrlCommands, parseLoginShellEnv, quitsWithLastWindow, SERVICE_LABEL, serviceFiles, startupMethod, systemdUnit, systemdUserDir } from './platform.mjs';

test('isWsl : noyau Microsoft ou WSL_DISTRO_NAME, sous Linux seulement', () => {
  assert.equal(isWsl({ platform: 'darwin', release: '25.0.0' }), false);
  assert.equal(isWsl({ platform: 'linux', release: '6.8.0-generic' }), false);
  assert.equal(isWsl({ platform: 'linux', release: '5.15.153.1-microsoft-standard-WSL2' }), true);
  assert.equal(isWsl({ platform: 'linux', release: '6.8.0-generic', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), true);
  assert.equal(isWsl({ platform: 'darwin', release: '25.0.0', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), false);
});

test('managedSettingsFile : macOS, Linux, sinon null', () => {
  assert.equal(managedSettingsFile('darwin'), '/Library/Application Support/ClaudeCode/managed-settings.json');
  assert.equal(managedSettingsFile('linux'), '/etc/claude-code/managed-settings.json');
  assert.equal(managedSettingsFile('aix'), null);
});

test('openUrlCommands : open, xdg-open, navigateur Windows sous WSL', () => {
  assert.deepEqual(openUrlCommands({ platform: 'darwin', wsl: false }), [['open']]);
  assert.deepEqual(openUrlCommands({ platform: 'linux', wsl: false }), [['xdg-open']]);
  assert.deepEqual(openUrlCommands({ platform: 'linux', wsl: true }), [['wslview'], ['explorer.exe'], ['xdg-open']]);
});

test('startupMethod : launchd, systemd, ou rien', () => {
  assert.equal(startupMethod({ platform: 'darwin', hasSystemd: false }), 'launchd');
  assert.equal(startupMethod({ platform: 'linux', hasSystemd: true }), 'systemd');
  assert.equal(startupMethod({ platform: 'linux', hasSystemd: false }), null);
});

test('systemdUserDir : XDG_CONFIG_HOME, sinon ~/.config', () => {
  assert.equal(systemdUserDir({ env: {}, home: '/home/a' }), '/home/a/.config/systemd/user');
  assert.equal(systemdUserDir({ env: { XDG_CONFIG_HOME: '/x' }, home: '/home/a' }), '/x/systemd/user');
});

test('serviceFiles : agent launchd du label du service et unité systemd (XDG_CONFIG_HOME, sinon ~/.config)', () => {
  const home = path.join(path.sep, 'home', 'a');
  const xdg = path.join(path.sep, 'x');
  assert.deepEqual(serviceFiles({ home, env: {} }), [
    path.join(home, 'Library', 'LaunchAgents', 'dev.vigie.daemon.plist'),
    path.join(home, '.config', 'systemd', 'user', 'vigie.service'),
  ]);
  assert.equal(serviceFiles({ home, env: { XDG_CONFIG_HOME: xdg } })[1], path.join(xdg, 'systemd', 'user', 'vigie.service'));
  // Le plist posé par `vigie install` porte ce label : le fichier testé par l'app est bien celui du service.
  assert.equal(path.basename(serviceFiles({ home })[0]), `${SERVICE_LABEL}.plist`);
  assert.ok(launchdPlist({ ...base, label: SERVICE_LABEL }).includes(`<key>Label</key><string>${SERVICE_LABEL}</string>`));
});

const base = { label: 'dev.vigie.daemon', node: '/usr/local/bin/node', server: '/opt/vigie/daemon/server.mjs', path: '/usr/bin:/bin', shell: '/bin/zsh', log: '/Users/a/.vigie/daemon.log' };

test('launchdPlist : identique au plist historique de bin/vigie.mjs (installs existantes inchangées)', () => {
  // Copie conforme du gabarit d'avant platform.mjs.
  const { label: LABEL, node, server: SERVER, path: PATH, shell: SHELL, log } = base;
  const before = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${SERVER}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATH}</string><key>SHELL</key><string>${SHELL}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
  assert.equal(launchdPlist(base), before);
});

test('launchdPlist : clés et échappement XML', () => {
  const p = launchdPlist({ ...base, path: '/a&b:/c<d>' });
  assert.ok(p.includes('<string>/usr/local/bin/node</string><string>/opt/vigie/daemon/server.mjs</string>'));
  assert.ok(p.includes('<key>KeepAlive</key><true/>'));
  assert.ok(p.includes('<key>RunAtLoad</key><true/>'));
  assert.ok(p.includes('<string>/a&amp;b:/c&lt;d&gt;</string>'));
  assert.ok(!p.includes('/a&b'));
});

test('launchdPlist et systemdUnit : CLAUDE_CONFIG_DIR de `vigie install` transmis au service, rien sinon', () => {
  const p = launchdPlist({ ...base, configDir: '/Users/a/cfg & co' });
  assert.ok(p.includes('<key>SHELL</key><string>/bin/zsh</string><key>CLAUDE_CONFIG_DIR</key><string>/Users/a/cfg &amp; co</string></dict>'));
  assert.ok(!launchdPlist({ ...base, configDir: null }).includes('CLAUDE_CONFIG_DIR'));
  const u = systemdUnit({ node: '/n', server: '/s', path: '/p', shell: '/bin/bash', log: '/l', configDir: '/home/a/cfg 50%' });
  assert.ok(u.includes('\nEnvironment="SHELL=/bin/bash"\nEnvironment="CLAUDE_CONFIG_DIR=/home/a/cfg 50%%"\nRestart=always\n'));
  assert.ok(!systemdUnit({ node: '/n', server: '/s', path: '/p', log: '/l' }).includes('CLAUDE_CONFIG_DIR'));
});

test('quitsWithLastWindow : Linux quitte avec la dernière fenêtre, macOS reste dans le Dock', () => {
  assert.equal(quitsWithLastWindow({ platform: 'linux' }), true);
  assert.equal(quitsWithLastWindow({ platform: 'darwin' }), false);
});

test('parseLoginShellEnv : valeurs entre octets nuls, sortie parasite écartée, délimiteurs manquants → null', () => {
  // Vrai shell POSIX (sh de macOS et de Linux) : printf rend bien les octets nuls, même avec un texte affiché avant et après.
  const script = `echo "bienvenue"; ${LOGIN_SHELL_ENV_ARGS.at(-1)}; echo "au revoir"`;
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { PATH: '/a b:/usr/bin:/bin', CLAUDE_CONFIG_DIR: '/c\nd' } });
  assert.deepEqual(parseLoginShellEnv(out), { PATH: '/a b:/usr/bin:/bin', configDir: '/c\nd' });
  assert.deepEqual(parseLoginShellEnv('\0/usr/bin\0\0'), { PATH: '/usr/bin', configDir: '' });
  for (const bad of ['', '/usr/bin\n/cfg', '\0/usr/bin\0', 'x\0y\0\0z\0']) assert.equal(parseLoginShellEnv(bad), null, JSON.stringify(bad));
});

test('systemdUnit : guillemets, %, $, Restart, WantedBy, PATH, SHELL facultatif', () => {
  const u = systemdUnit({ node: '/home/a/My Node/bin/node', server: '/opt/vi"gie/50%/$x/server.mjs', path: '/usr/bin:/bin', shell: '/bin/bash', log: '/home/a/.vigie/daemon.log' });
  assert.ok(u.includes('ExecStart="/home/a/My Node/bin/node" "/opt/vi\\"gie/50%%/$$x/server.mjs"\n'));
  assert.ok(u.includes('\nRestart=always\n'));
  assert.ok(u.includes('\nWantedBy=default.target\n'));
  assert.ok(u.includes('\nEnvironment="PATH=/usr/bin:/bin"\n'));
  assert.match(u, /\[Unit\][^[]*\nStartLimitIntervalSec=0\n/);
  assert.ok(u.includes('\nEnvironment="SHELL=/bin/bash"\n'));
  assert.ok(u.includes('\nStandardOutput=append:/home/a/.vigie/daemon.log\n'));
  assert.ok(systemdUnit({ node: '/n', server: '/s', path: '/p%', log: '/l' }).includes('Environment="PATH=/p%%"\nRestart=always'));
  assert.ok(!systemdUnit({ node: '/n', server: '/s', path: '/p', log: '/l' }).includes('SHELL='));
});

test('localeEnv : UTF-8 par défaut sans locale, rien si l\'utilisateur en a une', () => {
  assert.deepEqual(localeEnv({ platform: 'darwin', env: {} }), { LANG: 'en_US.UTF-8' });
  assert.deepEqual(localeEnv({ platform: 'linux', env: {} }), { LANG: 'C.UTF-8' });
  assert.deepEqual(localeEnv({ platform: 'linux', env: { LANG: 'fr_FR.UTF-8' } }), {});
  assert.deepEqual(localeEnv({ platform: 'darwin', env: { LC_ALL: 'C' } }), {});
  assert.deepEqual(localeEnv({ platform: 'darwin', env: { LANG: 'C' }, locale: 'fr_FR.UTF-8' }), { LANG: 'fr_FR.UTF-8', LC_ALL: 'fr_FR.UTF-8' });
  assert.equal(defaultLocale({ platform: 'linux', env: {} }), 'C.UTF-8');
  assert.equal(defaultLocale({ platform: 'darwin', env: { LANG: 'fr_FR.UTF-8' } }), 'fr_FR.UTF-8');
});

test('findOnPath : premier exécutable du PATH (macOS et Linux), entrées vides ou relatives ignorées', () => {
  const brew = path.join(path.sep, 'opt', 'homebrew', 'bin');
  const usr = path.join(path.sep, 'usr', 'bin');
  const home = path.join(path.sep, 'home', 'a', '.local', 'bin');
  const execs = new Set([path.join(brew, 'node'), path.join(usr, 'node'), path.join(home, 'node'), path.join('bin', 'node')]);
  const isExecutable = (f) => execs.has(f);
  const PATH = (...dirs) => ({ PATH: dirs.join(path.delimiter) });
  // macOS (Homebrew devant /usr/bin) et Linux (~/.local/bin, nvm, mise…) : l'ordre du PATH décide.
  assert.equal(findOnPath('node', { env: PATH('', 'bin', brew, usr), isExecutable }), path.join(brew, 'node'));
  assert.equal(findOnPath('node', { env: PATH(home, usr), isExecutable }), path.join(home, 'node'));
  assert.equal(findOnPath('node', { env: PATH(path.join(path.sep, 'nulle', 'part')), isExecutable }), null);
  assert.equal(findOnPath('node', { env: {}, isExecutable }), null);
});

test('nodeVersionOk : node 18 ou plus', () => {
  assert.equal(nodeVersionOk('v24.1.0\n'), true);
  assert.equal(nodeVersionOk('v18.0.0'), true);
  assert.equal(nodeVersionOk('v16.20.2'), false);
  assert.equal(nodeVersionOk(''), false);
  assert.equal(nodeVersionOk('bash: node: not found'), false);
});

test('localeInstalled : UTF-8 / utf8 et casse équivalents, absente refusée', () => {
  const mac = 'C\nPOSIX\nen_US.UTF-8\nfr_FR.UTF-8\nfr_FR.ISO8859-1\n';
  const linux = 'C\nC.utf8\nPOSIX\nen_US.utf8\nfr_FR.utf8\n';
  for (const [name, list] of [['fr_FR.UTF-8', mac], ['fr_FR.utf8', mac], ['fr_FR.UTF-8', linux], ['FR_fr.UTF8', linux], ['C.UTF-8', linux]]) assert.equal(localeInstalled(name, list), true, name);
  for (const [name, list] of [['de_DE.UTF-8', mac], ['fr_FR', linux], ['fr_FR.utf8@euro', linux], ['x', '']]) assert.equal(localeInstalled(name, list), false, name);
});

test('hasSystemd : Linux démarré par systemd avec bus utilisateur ; jamais sous macOS (aucun effet appelé)', () => {
  const never = () => { throw new Error('effet appelé hors Linux'); };
  assert.equal(hasSystemd({ platform: 'darwin', exists: never, userBus: never }), false);
  const seen = [];
  assert.equal(hasSystemd({ platform: 'linux', exists: (p) => (seen.push(p), true), userBus: () => true }), true);
  assert.deepEqual(seen, ['/run/systemd/system']);
  assert.equal(hasSystemd({ platform: 'linux', exists: () => false, userBus: never }), false); // WSL sans [boot] systemd=true
  assert.equal(hasSystemd({ platform: 'linux', exists: () => true, userBus: () => false }), false); // sudo, SSH sans bus
});

test('launchAgentFile : ~/Library/LaunchAgents/<label>.plist', () => {
  assert.equal(launchAgentFile({ home: '/Users/x', label: 'dev.vigie.daemon' }), path.join('/Users/x', 'Library', 'LaunchAgents', 'dev.vigie.daemon.plist'));
});

test('noServiceHelp : wsl.conf seulement sous WSL ; Linux et macOS proposent ~/.profile', () => {
  const wsl = noServiceHelp({ platform: 'linux', wsl: true });
  assert.match(wsl, /\/etc\/wsl\.conf/);
  assert.match(wsl, /systemd=true/);
  assert.match(wsl, /~\/\.profile/);
  for (const platform of ['linux', 'darwin']) {
    const t = noServiceHelp({ platform, wsl: false });
    assert.doesNotMatch(t, /wsl/i, platform);
    assert.match(t, /vigie start/, platform);
  }
  assert.match(noServiceHelp({ platform: 'linux', wsl: false }), /systemd utilisateur injoignable/);
});
