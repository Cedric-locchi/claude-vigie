import js from '@eslint/js';
import globals from 'globals';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

// Règles non négociables (CLAUDE.md, daemon/ARCHITECTURE.md) tenues par le lint. Un même fichier peut tomber dans plusieurs
// blocs : en config plate, le dernier bloc qui pose une règle la remplace en entier (pas de fusion des options). D'où les
// listes ci-dessous, recomposées dans chaque bloc qui pose `no-restricted-imports`.

// Partout (daemon, plugins, UI) : `zod/mini` seulement ; `zod` tire l'API chaînable complète (~454 Ko) dans l'app et le bundle.
const ZOD = { name: 'zod', message: "import * as z from 'zod/mini' (jamais 'zod' : taille de l'app et du bundle UI)" };
const ZOD_PATHS = { group: ['zod/*', '!zod/mini'], message: "zod/mini seulement (taille de l'app et du bundle UI)" };
// Le contrat de Vigie par son nom de paquet : electron-builder ne copie pas les liens de workspace (côté daemon), et un plugin n'y a pas accès.
const VIGIE_CONTRACT_PKG = ['@vigie/contract', '@vigie/contract/**'];
// Partout, tests compris : server.mjs démarre un vrai daemon (écrit ~/.vigie, purge des discussions). Statique et dynamique.
const SERVER_MSG = 'server.mjs démarre un daemon (écrit ~/.vigie, purge des discussions) : jamais importé, tester via createTransport / createStore';
const SERVER = { regex: '(^|/)server\\.mjs$', message: SERVER_MSG };
const SERVER_IMPORT = { selector: 'ImportExpression[source.value=/server\\.mjs$/]', message: SERVER_MSG };
const ZOD_IMPORT = { selector: 'ImportExpression[source.value=/^zod(\\/(?!mini$).*)?$/]', message: ZOD.message };
// import() échappe à no-restricted-imports : là où il reste permis (tests, plugins.mjs, UI), server.mjs et
// zod hors zod/mini sont refusés en dynamique aussi. Ailleurs, tout import() l'est déjà.
const DYNAMIC = [SERVER_IMPORT, ZOD_IMPORT];
// bin/, electron/, scripts/, tout .cjs : aucun import() (il échapperait aux listes d'autorisés et aux règles réseau).
const STATIC_ONLY = { selector: 'ImportExpression', message: 'imports statiques seulement : un import() échappe au lint' };
// Local uniquement (CLAUDE.md) : dans le daemon et le back des plugins, aucune requête sortante hors de daemon/claude-status.mjs
// (décision 024). transport.mjs sert HTTP et WebSocket (node:http, WebSocketServer de ws) sans en émettre.
const NET_MSG = 'aucune requête sortante : seul daemon/claude-status.mjs sort de la machine (décision 024)';
const NET = [
  ...['https', 'http2', 'net', 'tls', 'dgram', 'dns', 'dns/promises'].flatMap((m) => [m, `node:${m}`]).map((name) => ({ name, message: NET_MSG })),
  { name: 'ws', importNames: ['default', 'WebSocket', 'createWebSocketStream'], message: `${NET_MSG} (de ws, WebSocketServer seulement)` },
];
const HTTP = ['http', 'node:http'].map((name) => ({ name, message: 'node:http : serveur dans transport.mjs, proxy du statut dans claude-status.mjs, rien d’autre' }));
// Dans transport.mjs : node:http pour servir (createServer), jamais pour émettre ; importé sous le nom `http` (HTTP_ALIAS), donc
// `http.request` & co. tombent sous no-restricted-properties.
const HTTP_CLIENT_NAMES = ['request', 'get', 'Agent', 'ClientRequest', 'globalAgent'];
const HTTP_CLIENT = ['http', 'node:http'].map((name) => ({ name, importNames: HTTP_CLIENT_NAMES, message: NET_MSG }));
const HTTP_PROPS = HTTP_CLIENT_NAMES.map((property) => ({ object: 'http', property, message: NET_MSG }));
const NET_GLOBAL_NAMES = ['fetch', 'WebSocket', 'EventSource'];
const NET_GLOBALS = NET_GLOBAL_NAMES.map((name) => ({ name, message: NET_MSG }));
// Les mêmes par l'objet global (`globalThis.fetch`, `global.WebSocket`), qu'aucune règle de globales ne voit.
const NET_PROPS = ['globalThis', 'global'].flatMap((object) => NET_GLOBAL_NAMES.map((property) => ({ object, property, message: NET_MSG })));
// Chargement de module hors import statique (createRequire, process.getBuiltinModule) : il échapperait à toutes les règles d'import.
const LOADER_MSG = 'imports statiques seulement : createRequire et process.getBuiltinModule échappent au lint';
const LOADERS = ['module', 'node:module'].map((name) => ({ name, message: LOADER_MSG }));
// Sans objet : `process.getBuiltinModule`, `globalThis.process.getBuiltinModule`, et sa déstructuration.
const GET_BUILTIN = { property: 'getBuiltinModule', message: LOADER_MSG };
// CommonJS : un require() échappe à no-restricted-imports. Seul electron/preload.cjs en a besoin (une fenêtre sandboxée n'accepte
// pas l'ESM), et seulement pour `electron` ; partout ailleurs, l'ESM n'a pas de `require` (globals.nodeBuiltin : no-undef) et
// createRequire est refusé (LOADERS ; permis dans scripts/, qui s'en sert pour résoudre @angular/core).
// Pile réseau d'Electron par une session ou une page (`session.fetch`, `webContents.downloadURL`) ; le `fetch` global est un nom, pas visé.
const ELECTRON_NET_RE = '/^(fetch|downloadURL)$/';
const REQUIRE = { selector: "CallExpression[callee.name='require']:not([arguments.0.value='electron'])", message: "CommonJS : le preload d'Electron seulement, et require('electron') seulement (le reste en ESM, vérifié par le lint)" };
/** Un module de node importé sous un autre nom que le sien : `h.get()` échapperait aux règles écrites pour `http.get`. */
const NAMED_AS = (mod) => ({
  selector: `ImportDeclaration[source.value=/^(node:)?${mod}$/] > :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)[local.name!='${mod}']`,
  message: `node:${mod} s’importe sous le nom \`${mod}\` (les règles du lint visent ${mod}.x)`,
});
// Décision 044 : le Markdown de l'UI passe uniquement par renderMarkdown (ui/src/app/core/markdown.ts), seul à importer marked.
const MARKED = { group: ['marked', 'marked/*'], message: 'Markdown : renderMarkdown (core/markdown.ts) seulement, décision 044' };
// Daemon : contrat jamais par son nom de paquet ; ailleurs que dans transport.mjs et les tests, jamais du tout.
const CONTRACT_PKG = { group: VIGIE_CONTRACT_PKG, message: 'côté daemon, le contrat par chemin relatif (../contract/index.mjs), depuis transport.mjs seulement' };
const CONTRACT_ANY = { group: [...VIGIE_CONTRACT_PKG, '**/contract/**'], message: 'le contrat est importé par daemon/transport.mjs seulement (ARCHITECTURE.md)' };
// Tout ce qui dépend de l'OS passe par platform.mjs (pur, plateforme passée en argument). Les points d'entrée (server.mjs, bin/,
// electron/) lisent process.platform seulement pour le passer, `{ platform: process.platform }` ; ailleurs, aucune plateforme lue.
const PLATFORM_MSG = 'plateforme : une fonction de daemon/platform.mjs, qui reçoit `{ platform: process.platform }` du point d’entrée';
// Imports nommés qui liraient la plateforme sans passer par `os.x` / `process.x` (vus par les règles ci-dessous).
const PLATFORM_IMPORTS = [
  ...['os', 'node:os'].map((name) => ({ name, importNames: ['platform', 'type'], message: PLATFORM_MSG })),
  ...['process', 'node:process'].map((name) => ({ name, importNames: ['platform'], message: PLATFORM_MSG })),
];
const OS_TYPE = { object: 'os', property: 'type', message: `os.type() : ${PLATFORM_MSG}` };
const ALIASES = [NAMED_AS('os'), NAMED_AS('process')];
// Toute propriété `platform` (process, globalThis.process, os, un objet intermédiaire), calculée ou déstructurée. Hors points
// d'entrée : jamais. Dans un point d'entrée : seulement `process.platform` comme valeur d'une clé `platform`. Aucun autre
// `.platform` n'existe dans ces fichiers (les fonctions de platform.mjs déstructurent leurs paramètres, non visés).
const platformSyntax = ({ entry = false, message = PLATFORM_MSG } = {}) => [
  { selector: entry ? "MemberExpression[property.name='platform']:not(Property[key.name='platform'] > MemberExpression.value[object.name='process'])" : "MemberExpression[property.name='platform']", message },
  { selector: "MemberExpression[property.value='platform']", message },
  { selector: ':matches(VariableDeclarator, AssignmentExpression) > ObjectPattern > Property[key.name=\'platform\']', message },
];
// Daemon : imports par liste d'autorisés : node:*, ses modules (./x, sans sous-dossier ni `..`), le contrat par chemin, ws, node-pty,
// zod/mini ; `undici`, `got`, `cross-spawn`, `../node_modules/…` refusés.
const DAEMON_ALLOW = { regex: '^(?!(?:node:[\\w/]+|\\./[\\w-][\\w.-]*\\.mjs|\\.\\./contract/index\\.mjs|ws|node-pty|zod/mini)$)', message: 'le daemon n’importe que node:*, ses modules, ../contract/index.mjs, ws, node-pty et zod/mini (nouvelle dépendance = raison écrite)' };
const daemonImports = ({ http = HTTP, contract = CONTRACT_ANY, platform = PLATFORM_IMPORTS } = {}) => ['error', { paths: [ZOD, ...NET, ...http, ...platform, ...LOADERS], patterns: [DAEMON_ALLOW, ZOD_PATHS, SERVER, contract] }];
const DAEMON_DYNAMIC_IMPORT = { selector: 'ImportExpression', message: 'pas d’import() dynamique dans le daemon (seul plugins.mjs charge les plugins) : un import statique, vérifié par le lint' };
const PLUGIN_MSG = 'pas de plateforme lue dans un plugin : la disponibilité se lit dans la réponse de l’outil';

// Décision 037 : le front d'un plugin ne parle à Vigie que par le SDK. Liste d'autorisés (tout le reste est refusé) : le SDK,
// Angular, spartan (helm), zod/mini, son ../contract.mjs (son contrat) et ses propres fichiers ./… (sans `..`). Un segment ne
// commence jamais par un point : `@angular/core/../../x` ou `./a/../../x` ne sortent pas. Les specs ajoutent le SDK de test et vitest.
// ponytail: `../contract.mjs` et `./…` supposent les fichiers à plat dans ui/ ; un sous-dossier de ui/ demandera d'élargir la liste (alias).
const SEG = '(?:/[\\w-][\\w.-]*)';
const pluginFront = (extra = []) => ({
  regex: `^(?!(?:${['@vigie/plugin-sdk', `@angular${SEG}+`, `@spartan-ng/helm${SEG}+`, 'zod/mini', '\\.\\./contract\\.mjs', `\\.${SEG}+`, ...extra].join('|')})$)`,
  message: 'un plugin n’importe que @vigie/plugin-sdk, @angular/*, @spartan-ng/helm/*, zod/mini, son ../contract.mjs et ses fichiers ./… (décision 037)',
});
const pluginFrontImports = (extra) => ['error', {
  patterns: [pluginFront(extra), SERVER, { group: ['@angular/common/http/*'], message: 'pas de HttpClient dans un plugin : PluginHost.call (réponse validée par son schéma)' },
    // Un fichier JS voisin (./x.mjs) échapperait aux règles du front, écrites pour le TypeScript ; ../contract.mjs reste permis.
    { regex: '^\\./.*\\.[cm]?js$', message: 'le front d’un plugin n’importe que ses fichiers TypeScript (./x) et ../contract.mjs' }],
  paths: [
    // Une chaîne d'un outil (nom de tâche, sortie de nx) ne doit jamais devenir du HTML de confiance.
    { name: '@angular/platform-browser', importNames: ['DomSanitizer'], message: 'pas de DomSanitizer dans un plugin : le texte reste du texte' },
    { name: '@angular/common/http', message: 'pas de HttpClient dans un plugin : PluginHost.call (réponse validée par son schéma)' },
  ],
}];
// Réseau du front d'un plugin : rien en direct, par leur nom (globales) ou comme propriété de n'importe quel objet
// (`globalThis.fetch`, `inject(DOCUMENT).defaultView.fetch`, `navigator.sendBeacon`, forme calculée `x['fetch']` comprise).
const FRONT_NET_MSG = 'un plugin parle à son back par PluginHost (call, terminal), jamais par le réseau en direct';
// Un worker (CSP : worker-src 'self' blob:) ferait ses propres requêtes.
const FRONT_NET_NAMES = [...NET_GLOBAL_NAMES, 'XMLHttpRequest', 'Worker', 'SharedWorker'];
const FRONT_NET_RE = '/^(fetch|sendBeacon|WebSocket|EventSource|XMLHttpRequest|Worker|SharedWorker)$/';
const FRONT_HTML_RE = '/^(innerHTML|outerHTML|insertAdjacentHTML|setHTMLUnsafe|createContextualFragment)$/';
const FRONT_HTML_MSG = 'pas de HTML de confiance dans un plugin : interpolation {{ }} seulement';
// Le front ne quitte jamais la page et n'en ouvre pas d'autre (les liens externes passent par l'app). Seulement par les objets
// globaux usuels : `.open` / `.location` sur n'importe quel objet viserait aussi dialogues et signaux.
const FRONT_LEAVE_MSG = 'un plugin ne navigue pas hors de l’UI (ni window.open, ni location)';

export default tseslint.config(
  // ui/libs/ui : composants spartan générés, qu'on ne retouche pas (voir CLAUDE.md).
  { ignores: ['node_modules/**', 'dist/**', '**/dist/**', '.vigie/**', 'ui/.angular/**', 'ui/libs/ui/**'] },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    // nodeBuiltin : les globales de Node sans celles de CommonJS (`require`, `module`, `__dirname`…), absentes en ESM.
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.nodeBuiltin },
    rules: {
      // `const { MISE_YES: _yes, ...reste } = env` : retirer une clé par déstructuration est voulu.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-restricted-imports': ['error', { paths: [ZOD], patterns: [ZOD_PATHS, SERVER] }],
      'no-restricted-syntax': ['error', ...DYNAMIC],
    },
  },
  {
    // CommonJS (preload d'Electron : une fenêtre sandboxée n'accepte pas l'ESM).
    files: ['**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    // Hors bin/ et electron/ (qui posent leurs règles) : ni import(), ni réseau, ni plateforme lue.
    rules: { 'no-restricted-syntax': ['error', STATIC_ONLY, REQUIRE, ...platformSyntax()], 'no-restricted-globals': ['error', ...NET_GLOBALS], 'no-restricted-properties': ['error', GET_BUILTIN, ...NET_PROPS] },
  },
  {
    // Daemon : imports par liste d'autorisés, contrat (cf. CONTRACT_*), réseau sortant, plateforme ; import() dynamique seulement
    // dans le chargeur de plugins (un import() échappe à no-restricted-imports).
    files: ['daemon/**/*.mjs'],
    rules: {
      'no-restricted-imports': daemonImports(),
      'no-restricted-globals': ['error', ...NET_GLOBALS],
      'no-restricted-properties': ['error', OS_TYPE, GET_BUILTIN, ...NET_PROPS],
      'no-restricted-syntax': ['error', DAEMON_DYNAMIC_IMPORT, ...ALIASES, ...platformSyntax()],
    },
  },
  {
    // Le transport sert HTTP (node:http sous le nom `http` : createServer, jamais de client) et importe le contrat par chemin relatif.
    files: ['daemon/transport.mjs'],
    rules: {
      'no-restricted-imports': daemonImports({ http: HTTP_CLIENT, contract: CONTRACT_PKG }),
      'no-restricted-properties': ['error', OS_TYPE, GET_BUILTIN, ...NET_PROPS, ...HTTP_PROPS],
      'no-restricted-syntax': ['error', DAEMON_DYNAMIC_IMPORT, ...ALIASES, NAMED_AS('http'), ...platformSyntax()],
    },
  },
  {
    // Seul module qui sort (décision 024) : fetch, et node:http pour le proxy de l'environnement (setGlobalProxyFromEnv).
    files: ['daemon/claude-status.mjs'],
    rules: {
      'no-restricted-imports': daemonImports({ http: [] }),
      'no-restricted-globals': 'off',
      'no-restricted-properties': ['error', OS_TYPE, GET_BUILTIN],
    },
  },
  {
    // Tests : contrat (pour `conforme`, import() compris), jamais server.mjs ; ni plateforme ni réseau, comme le daemon.
    files: ['daemon/**/*.test.mjs'],
    rules: {
      'no-restricted-imports': daemonImports({ contract: CONTRACT_PKG }),
      'no-restricted-syntax': ['error', ...DYNAMIC, ...ALIASES, ...platformSyntax()],
    },
  },
  {
    files: ['daemon/plugins.mjs'],
    rules: { 'no-restricted-syntax': ['error', ...DYNAMIC, ...ALIASES, ...platformSyntax()] },
  },
  {
    // Scripts lancés par Claude Code (depuis app.asar.unpacked/daemon, où ni ../contract ni node_modules n'existent) et ce
    // qu'ils importent : node:* et ces quatre modules seulement (ARCHITECTURE.md).
    files: ['daemon/hook.mjs', 'daemon/statusline.mjs', 'daemon/launch.mjs', 'daemon/paths.mjs'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [...NET, ...HTTP, ...PLATFORM_IMPORTS, ...LOADERS],
        patterns: [{ regex: '^(?!node:|\\./(hook|statusline|launch|paths)\\.mjs$)', message: 'hook.mjs, statusline.mjs, launch.mjs et paths.mjs n’importent que node:* et ces quatre modules' }],
      }],
    },
  },
  {
    // Point d'entrée du daemon : process.platform lu seulement pour être passé (`{ platform: process.platform }` au transport).
    files: ['daemon/server.mjs'],
    rules: { 'no-restricted-syntax': ['error', DAEMON_DYNAMIC_IMPORT, ...ALIASES, ...platformSyntax({ entry: true })] },
  },
  {
    // Le point de plateforme lui-même (pur : la plateforme arrive en argument, mais rien ne lui interdit de la lire).
    files: ['daemon/platform.mjs'],
    rules: { 'no-restricted-imports': daemonImports({ platform: [] }), 'no-restricted-properties': ['error', GET_BUILTIN, ...NET_PROPS], 'no-restricted-syntax': ['error', DAEMON_DYNAMIC_IMPORT] },
  },
  {
    // CLI et app de bureau : comme server.mjs, process.platform seulement passé à platform.mjs, jamais comparé ici ;
    // imports nus : node:*, relatifs (modules .mjs du daemon et du contrat) et electron. Réseau : rien d'autre que le `fetch` global
    // vers le daemon local, `${ORIGIN}…` (http://127.0.0.1:PORT dans les deux fichiers) ; ni node:http, ni WebSocket, ni le `net`
    // d'Electron, ni sa pile par une session (`session.fetch`, `webContents.downloadURL`).
    files: ['bin/**/*.{js,mjs,cjs}', 'electron/**/*.{js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [ZOD, ...NET, ...HTTP, ...PLATFORM_IMPORTS, ...LOADERS, { name: 'electron', importNames: ['net'], message: NET_MSG }],
        patterns: [{ regex: '^(?!(?:node:[\\w/]+|\\./[\\w-][\\w.-]*\\.[cm]?js|\\.\\./(?:daemon|contract)/[\\w-][\\w.-]*\\.mjs|electron)$)', message: 'la CLI et l’app n’importent que node:*, leurs fichiers, ../daemon/*.mjs, ../contract/*.mjs et electron' }, ZOD_PATHS, SERVER],
      }],
      'no-restricted-globals': ['error', ...NET_GLOBALS.filter((g) => g.name !== 'fetch')],
      'no-restricted-properties': ['error', OS_TYPE, GET_BUILTIN, ...NET_PROPS, { property: 'net', message: `${NET_MSG} (le net d'Electron)` }],
      'no-restricted-syntax': ['error', STATIC_ONLY, REQUIRE, ...ALIASES, ...platformSyntax({ entry: true }),
        { selector: "CallExpression[callee.name='fetch']:not([arguments.0.quasis.0.value.raw=''][arguments.0.expressions.0.name='ORIGIN'])", message: 'fetch : vers le daemon local seulement, `${ORIGIN}/…` (http://127.0.0.1:PORT)' },
        ...[`MemberExpression[property.name=${ELECTRON_NET_RE}]`, `MemberExpression[property.value=${ELECTRON_NET_RE}]`, `ObjectPattern > Property[key.name=${ELECTRON_NET_RE}]`]
          .map((selector) => ({ selector, message: `${NET_MSG} (session.fetch, downloadURL : la pile réseau d'Electron)` }))],
    },
  },
  {
    // Outils de build et de test : aucune plateforme lue non plus (rien n'en a besoin aujourd'hui), aucune requête sortante.
    files: ['scripts/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [ZOD, ...NET, ...HTTP, ...PLATFORM_IMPORTS], patterns: [ZOD_PATHS, SERVER] }],
      'no-restricted-globals': ['error', ...NET_GLOBALS],
      'no-restricted-properties': ['error', OS_TYPE, GET_BUILTIN, ...NET_PROPS],
      'no-restricted-syntax': ['error', STATIC_ONLY, ...ALIASES, ...platformSyntax()],
    },
  },
  {
    // Back d'un plugin (ARCHITECTURE.md, « Interdit ») : tout module du plugin hors de son front, de son contrat et de ses tests.
    // Imports par liste d'autorisés : node:* et ses propres fichiers ./… (sans `..`, donc ni Vigie ni un autre plugin, ni son ui/) ; parmi
    // eux, ni child_process (process par vigie.exec : groupe tué au délai, à l'abandon et à l'arrêt) ni réseau ; aucune plateforme lue.
    // ponytail: un module de lib/ ne peut pas importer ../contract.mjs ; élargir la liste par dossier si un plugin en a besoin.
    files: ['plugins/*/**/*.{js,mjs}'],
    ignores: ['plugins/*/contract.mjs', 'plugins/*/**/*.test.mjs', 'plugins/*/ui/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [...NET, ...HTTP, ...PLATFORM_IMPORTS, ...LOADERS, { name: 'node:child_process', message: 'vigie.exec (SDK) : délai, signal, groupe tué à l’arrêt' }, { name: 'child_process', message: 'vigie.exec (SDK)' }],
        patterns: [{ regex: '^(?!(?:node:[\\w/]+|\\.(?!/ui/)(?:/[\\w-][\\w.-]*)+\\.m?js)$)', message: 'un plugin n’importe que node:* et ses fichiers ./… hors de ui/ (son ./contract.mjs ; le SDK arrive en argument)' }],
      }],
      'no-restricted-globals': ['error', ...NET_GLOBALS],
      'no-restricted-properties': ['error', OS_TYPE, GET_BUILTIN, ...NET_PROPS],
      'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'pas d’import() dynamique dans un plugin : imports statiques, vérifiés par le lint' }, ...ALIASES, ...platformSyntax({ message: PLUGIN_MSG })],
    },
  },
  {
    // Schémas partagés avec l'UI (le contrat de Vigie, celui d'un plugin) : zod/mini et rien d'autre (compilés aussi dans le bundle).
    files: ['contract/**/*.mjs', 'plugins/*/contract.mjs'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!zod/mini$)', message: 'un contrat n’importe que zod/mini' }] }],
      'no-restricted-syntax': ['error', { selector: 'ImportExpression', message: 'un contrat n’importe que zod/mini, statiquement' }, ...platformSyntax()],
    },
  },
  {
    files: ['ui/**/*.ts', 'plugins/*/ui/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // Même convention que le code Node : `_x` désigne un paramètre ou une clé volontairement ignorés.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-restricted-imports': ['error', { paths: [ZOD], patterns: [ZOD_PATHS, SERVER, MARKED] }],
      // import() échappe à no-restricted-imports : mêmes interdits, en dynamique.
      'no-restricted-syntax': ['error', ...DYNAMIC, { selector: 'ImportExpression[source.value=/^marked(\\/|$)/]', message: MARKED.message }],
    },
  },
  {
    files: ['ui/src/app/core/markdown.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [ZOD], patterns: [ZOD_PATHS, SERVER] }] },
  },
  {
    // Front d'un plugin (décision 037) : imports par liste d'autorisés (cf. pluginFront) ; ni réseau en direct, ni import()
    // dynamique (il échapperait à la liste), ni HTML de confiance.
    files: ['plugins/*/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': pluginFrontImports(),
      'no-restricted-globals': ['error', ...FRONT_NET_NAMES.map((name) => ({ name, message: FRONT_NET_MSG })), ...['open', 'location'].map((name) => ({ name, message: FRONT_LEAVE_MSG }))],
      'no-restricted-syntax': ['error',
        { selector: 'ImportExpression', message: 'pas d’import() dynamique dans un plugin : imports statiques, vérifiés par le lint' },
        { selector: `MemberExpression[property.name=${FRONT_NET_RE}]`, message: FRONT_NET_MSG },
        { selector: `MemberExpression[property.value=${FRONT_NET_RE}]`, message: FRONT_NET_MSG },
        { selector: `ObjectPattern > Property[key.name=${FRONT_NET_RE}]`, message: FRONT_NET_MSG },
        { selector: 'MemberExpression[property.name=/^bypassSecurityTrust/]', message: 'pas de bypassSecurityTrust* dans un plugin' },
        { selector: `MemberExpression[property.name=${FRONT_HTML_RE}]`, message: FRONT_HTML_MSG },
        { selector: `MemberExpression[property.value=${FRONT_HTML_RE}]`, message: FRONT_HTML_MSG },
        // Liaison par chaîne : host: { '[innerHTML]': … }, @HostBinding('innerHTML'), renderer.setProperty(el, 'innerHTML', …).
        { selector: 'Literal[value=/^\\[?(inner|outer)HTML\\]?$/i]', message: FRONT_HTML_MSG },
        { selector: 'Property[key.name=/^(inner|outer)HTML$/i]', message: FRONT_HTML_MSG },
      ],
      'no-restricted-properties': ['error', ...['window', 'self', 'globalThis', 'document'].flatMap((object) => ['open', 'location'].map((property) => ({ object, property, message: FRONT_LEAVE_MSG })))],
    },
  },
  {
    // Specs du front d'un plugin : en plus, le SDK de test et vitest.
    files: ['plugins/*/ui/**/*.spec.ts'],
    rules: { 'no-restricted-imports': pluginFrontImports(['@vigie/plugin-sdk/testing', 'vitest']) },
  },
  {
    // Gabarits en ligne des fronts de plugins (processInlineTemplates) : pas de liaison [innerHTML] / [outerHTML], casse ignorée
    // (Angular traduit `[innerHtml]` en innerHTML).
    files: ['plugins/*/ui/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
      'no-restricted-syntax': ['error', { selector: 'BoundAttribute[name=/^(inner|outer)HTML$/i]', message: 'pas de [innerHTML] dans un plugin : interpolation {{ }} seulement' }],
    },
  },
  {
    files: ['ui/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    // `x != null` (null ou undefined) est l'idiome des templates du projet.
    rules: { '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }] },
  },
);
