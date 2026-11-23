# Architecture du daemon

Pas de framework, pas de base, pas de couche d'abstraction : des modules de quelques fonctions, un sens de dépendance.
Source de vérité : les transcripts de Claude Code (`projects/` du dossier de config de Claude : `$CLAUDE_CONFIG_DIR` s'il est défini, sinon `~/.claude` ; `paths.claudeConfigDir`) et le spool des hooks (`~/.vigie/spool.jsonl`).
Le store se reconstruit toujours depuis eux ; rien d'important ne vit seulement en mémoire.

## Modules

| Module | Rôle | I/O |
|---|---|---|
| `server.mjs` | Point d'entrée (npm start, launchd / systemd --user, Electron) : lit l'environnement (seul module du daemon à lire `process.platform`, passé au transport), crée le store et le transport, puis `listen` sur 127.0.0.1. Avant `listen`, deux effets seulement, jugés sans risque pour un daemon déjà en place : `openHistory` met de côté un `usage.json` illisible (renommé, jamais écrasé : le premier daemon l'a déjà fait au sien) et `createPlugins` importe les plugins activés, qui créent `plugins-data/<id>` (création de dossier idempotente). **Tous les autres effets attendent `listen`** : `EADDRINUSE` (un second daemon relancé par systemd ou launchd) → message et sortie sans rien purger, réécrire ni faire tourner ; une erreur du serveur après `listen` (EMFILE…) est journalisée, sans sortie (elle tuerait tous les PTY). Dans le callback : crée `~/.vigie/chat`, écrit `~/.vigie/hooks.json` (commande node : `launch.nodeCommand`), scanne, enregistre l'historique de consommation (avant la purge des discussions, puis toutes les 10 min), purge les discussions, fait tourner puis lit le spool (`ingest.readNewLines`), arme watchers (`fs.watch` → `ingest.batchWatch` → `store.scanFiles` sur les fichiers nommés, 250 ms après le premier événement, noms accumulés ; sans nom, `store.scan` ; écouteur `error` : une erreur asynchrone du watcher est journalisée, le scan de 5 s continue) et timers (scan complet 5 s, spool 500 ms, snapshot 15 s), relève le statut de Claude toutes les 5 min. Chaque callback de timer ou de watcher est sous try (`guarded`) ; une promesse rejetée (relevé du statut) finit en `unhandledRejection`, journalisé. À l'arrêt (SIGTERM, SIGINT, `exit`), tue les groupes de `plugins.exec` et de `git.run` (`killAll`) ; l'option `shutdown` du transport (`POST /api/shutdown`, décision 050) passe par ce même chemin (`process.kill(process.pid, 'SIGTERM')`). Aucune route, aucune règle métier. | oui (câblage) |
| `transport.mjs` | `createTransport()` : HTTP, WebSocket, PTY, contrôle d'hôte et d'origine, statiques (avec la CSP, `guard.csp`). Traduit requête → appel du store ou d'un adaptateur → JSON. Pas de `listen`, pas d'effet à l'import. Garde en mémoire les réglages du daemon (`/api/settings`) et l'état des plugins (`plugins` de `settings.json`), lus et écrits par `settings.mjs`. Ouvre le PTY d'un terminal décrit par un plugin. `POST /api/shutdown` (décision 050) répond `{ ok: true }` puis appelle l'option `shutdown` à `finish` ; sans option, 404 ; le transport ne touche jamais au process. | PTY, réseau (par `settings.mjs` : `~/.vigie/settings.json`, `locale -a`) |
| `settings.mjs` | Réglages du daemon : `readSettings` (schéma passé par le transport ; absent, illisible ou hors contrat → `{ locale: null }`), `keepBooleanPlugins` (pur : un `plugins` hors contrat ne garde que ses entrées booléennes), `writeSettings` (tmp + rename), `listLocales` (`locale -a` sans shell, 3 s, null en échec). | `~/.vigie/settings.json`, `locale -a` |
| `paths.mjs` | Chemins partagés, pur (`node:path` seulement) : `expandHome` / `tildePath` (`~` dans les deux sens, séparateur exigé : `/Users/x2` n'est pas sous `/Users/x`), `claudeConfigDir` (`CLAUDE_CONFIG_DIR`, sinon `~/.claude`), `claudeJsonFile` (`$CLAUDE_CONFIG_DIR/.claude.json`, sinon `~/.claude.json`, comme Claude Code), `claudeConfigPaths` (config globale protégée : `~/.claude`, `~/.claude.json`, `CLAUDE_CONFIG_DIR`), `isInside`. Utilisé par le daemon, `statusline.mjs`, la CLI (`claudeConfigDir`, `CLAUDE_CONFIG_DIR` écrit dans le service) et Electron (`expandHome`). | aucune |
| `store.mjs` | État en mémoire et agrégats : sessions, états, détail, trace, journal (200 pistes gardées, la moins récemment lue oubliée), recherche dans les sessions (`searchSessions`, seule méthode asynchrone du store : sessions montrées par le snapshot, `shown` ; titre de la session, puis titre et texte des lignes de son journal, servies par le cache du journal ; 150 pistes parcourues au plus, une session qui n'y tient plus est sautée, `truncated` ; cède la main entre deux pistes, `null` si le `signal` de la requête est annulé), discussions (`isChat`, `purge` gardé par `isChat` et qui ne lève jamais, `purgeChats`), dossiers récents, `cwdOf`, `idle` (Claude ne travaille pas : tour rendu ou terminé, aucun sous-agent actif). `scan` (tout) et `scanFiles` (transcripts nommés par `fs.watch`). Lit `~/.vigie/hidden.json` (écrit par tmp + rename) et `~/.vigie/limits/` (`readReadings`, relu seulement si le dossier a changé ou chaque minute, en gardant le pic de chaque fenêtre de 5 h). Historique de consommation `~/.vigie/usage.json` (décision 025) : lu une fois à la création (illisible → mis de côté en `usage.json.corrupt-<ts>`, jamais écrasé ; absent → premier scan sur 31 jours), écrit par `saveHistory` (tmp + rename, ne lève jamais) ; lignes d'une discussion sans titre, jamais de début de prompt archivé ; réécrit seulement s'il y a du neuf (ou une fois par heure). Coût d'une session au fil du temps (`sessionCost`). Dernier plan proposé par l'agent principal (`sessionPlan`). | lecture ; écriture limitée à `hidden.json`, `usage.json`, au ménage de `limits/` et à `purge` |
| `history.mjs` | Fichier d'historique `~/.vigie/usage.json` : `openHistory` (lecture une fois ; illisible → mis de côté, jamais écrasé ; absent → `seed`), `writeHistory` (tmp + rename). Le contenu est calculé par `usage.mjs`. | `usage.json` |
| `trace.mjs` | Trace d'une session en tours, pur : `buildTrace({ main, subs, summary, now })`. Étape `interrupted` (toujours émise, booléen requis par le contrat) : outil clos par un Échap (ingest), ou sans résultat dans une session terminée. | aucune |
| `usage.mjs` | Consommation, pur : jour en cours, fenêtre de 5 h (estimée ou réelle à partir des relevés), lignes jour × session × modèle, consommation d'une session. Historique : `trackRows` (lignes d'une piste, clé `<session>/<fichier>`), `mergeRows` (une piste en mémoire remplace ses lignes archivées, coupe à 400 j), `sessionRows`, `validHistory` ; fenêtres closes `quotaBlocks` / `mergeWindows` (archive figée, jamais de chevauchement) ; série de coût `costSeries`. | aucune |
| `ingest.mjs` | Décodage des transcripts, pur, plus la lecture incrémentale du fichier qu'on lui confie (`readNewLines`, aussi pour le spool : jamais d'exception, remise à zéro si le fichier raccourcit). États (`deriveState`) ; un Échap (message « user » dont le seul bloc texte est `[Request interrupted by user]` ou `[… for tool use]`, sans hook Stop) rend le tour (« à toi » : `lastStop = 'interrupted'`, valeur interne hors contrat), clôt l'outil en attente comme interrompu et efface `lastError` (le refus écrit par Claude Code n'est pas un « souci »), n'est pas un message de l'humain, et un événement de hook antérieur (`interruptTs >= live.ts`) ne le masque plus ; le même texte tapé par l'humain (enregistrement avec `promptSource`, jamais porté par le marqueur) reste un message. Dernier plan proposé (`ExitPlanMode` : `input.plan` s'il est non vide, sinon, pour l'input `{}` de Claude Code ≥ 2.1.326, `planDraft` : dernier fichier `…/plans/*.md` écrit par Write dans le transcript, Edit sur ce fichier rejoués, suivi par `trackPlanDraft` sans lecture disque ; `planFilePath` jamais lu) gardé dans `plan` (`{text, ts}`), servi par `store.sessionPlan` (`GET /api/sessions/:id/plan`, 404 sans plan) et daté dans `SessionSummary.planTs`. `excerpt` : extrait ≤ 200 caractères d'une ligne centré sur le terme trouvé (recherche dans les fichiers et dans les sessions). `batchWatch` : regroupe les événements de `fs.watch` (lot 250 ms après le premier événement, pas après le dernier ; chemins nommés accumulés, événement sans nom = scan complet). `WORKTREES` : segment `<sep>.claude<sep>worktrees<sep>`, seule définition. | lecture du fichier passé |
| `guard.mjs`, `launch.mjs` | Fonctions pures du transport, de l'entrée et des scripts lancés par Claude Code : hôte, chemin statique, CSP (`csp(port)`), commande `claude`, commande node des scripts (`nodeCommand`), contenu de `hooks.json` (chemins quotés par `shQuote`), ligne du spool, statusline (`userStatusLine`, `limitsReading`). | aucune |
| `pricing.mjs` | Tarifs, `costOf`. | aucune |
| `platform.mjs` | Point de plateforme unique (macOS, Linux, WSL), pur : `isWsl`, `managedSettingsFile`, `findOnPath` / `nodeVersionOk` (node du PATH pour les scripts lancés par Claude Code, au lieu d'Electron), `openUrlCommands`, `localeEnv` / `defaultLocale` (locale des PTY), `localeInstalled` (locale choisie présente dans `locale -a`, casse et `UTF-8` / `utf8` confondus), `quitsWithLastWindow` (l'app quitte avec sa dernière fenêtre, sauf macOS), `LOGIN_SHELL_ENV_ARGS` / `parseLoginShellEnv` (PATH et `CLAUDE_CONFIG_DIR` du shell de connexion, lus entre octets nuls), `startupMethod`, `hasSystemd` (`/run/systemd/system` + bus utilisateur, effets injectés), `systemdUserDir`, `launchAgentFile`, `SERVICE_LABEL` / `serviceFiles` (agent launchd et unité systemd que `vigie install` peut avoir posés, sans branche par OS : l'appelant teste leur présence ; Electron refuse de démarrer si l'un existe), `noServiceHelp` (explication de `vigie install` sans service : WSL, Linux, macOS), contenus `launchdPlist` / `systemdUnit` (PATH, SHELL et, s'il est défini à l'installation, `CLAUDE_CONFIG_DIR`). Plateforme, release et env injectés : les tests simulent Linux depuis un Mac. Utilisé aussi par `bin/vigie.mjs` et `electron/main.mjs`. | aucune |
| `contract/index.mjs` (workspace `@vigie/contract`) | Schémas zod (`zod/mini` uniquement) : miroir exact des sorties (dont dérive `ui/.../models.ts`) et schémas d'entrée (corps POST, messages `/pty`). Partagé par le daemon, les tests et l'UI. | aucune |
| `git.mjs`, `claude-config.mjs` | Adaptateurs : `git` et `claude -p` par `run` (`spawn` sans shell, groupe de processus détaché, sauf `headBranch`, qui lit `.git/HEAD` directement), avec délai (git 2 min, commit 10 min pour les hooks pre-commit, `claude -p` 2 min) ; seul `suggestCommitMessage` reçoit aussi le `signal` de la requête (onglet fermé → claude et ses git tués) : `readGitDiff` (calcul partagé par le cache : 1,5 s par cwd, entrées expirées retirées à chaque calcul), `restoreFile`, `commitAll`, `createBranch` vont au bout ou au délai. Délai et abandon tuent tout le groupe, enfants d'un hook pre-commit compris : SIGTERM, puis SIGKILL 5 s plus tard s'il traîne (minuteur de `run`). À l'arrêt du daemon, `killAll` envoie SIGTERM seul à chaque groupe encore vivant (git retire son index.lock ; le daemon sort juste après, un SIGKILL différé ne partirait pas). stdout au-delà de `maxBuffer` (32 Mo) ou stderr au-delà de 32 Mo : rejet, sauf lecture bornée (`cut` : stdout seul compté, outil arrêté, début de la sortie rendu ; diff du message de commit, dont des avertissements sur stderr, CRLF par exemple, n'avancent pas la coupure). Lecture seule de la config Claude (dossier utilisateur par `paths.claudeConfigDir`, `.claude.json` par `paths.claudeJsonFile`, réglages gérés passés par le transport). | oui |
| `projects.mjs` | Sélecteur de projet (décision 029) : `projectKind` (pur : noms à la racine → `ios` / `node` / `rust` / `go` / `python` / `java` / null, iOS d'abord), `childDirs` (sous-dossiers non cachés du chemin tapé, 50 max), `describeDirs` (une `readdir` + `git.headBranch` par dossier, sans process ; dossier illisible → kind et branch null), `listProjects` (choix de `GET /api/projects` : sous-dossiers du chemin tapé, sinon récents ; chemins en `~/…`). | lecture |
| `files.mjs` | Adaptateur de l'explorateur : arbre du projet (`listProjectFiles` : `git ls-files` suivis + non suivis + ignorés, dossiers ignorés repliés ; hors dépôt, parcours en largeur sans suivre les liens, `node_modules` / `.git` repliés ; 20 000 entrées max), lecture et écriture de n'importe quel fichier texte du projet (`readProjectFile`, `writeProjectFile`) avec les gardes de `git.mjs` (`checkFile`, `replaceFile`) et `paths.isInside` ; recherche de texte littéral (`searchProjectFiles` : dans un dépôt, suivis + non suivis seulement, jamais les ignorés ; hors dépôt, tout l'arbre de `listProjectFiles`, `.env` compris ; mêmes gardes que `checkFile`, sautées sans erreur : liens, fichiers hors de la racine par un dossier parent lien, binaires, non UTF-8, > `MAX_PATCH` ; 2 000 lignes max, annulable par `AbortSignal`). | oui |
| `plugins.mjs` | Plugins (décisions 034, 037), `API = 2` : `readManifests` (`plugins/*/package.json`, champ `vigie`, lecture synchrone sans import ; aussi lu par `scripts/plugin-uis.mjs`), `exec` (spawn sans shell, stdin fermé, groupe détaché tué au délai, au `signal` ou au-delà de `maxBuffer`, ne rejette jamais), `createSdk` (`definePlugin` : forme vérifiée au chargement, `z`, `exec`, `terminal`, `error`, `dataDir`), `loadPlugin` (runner `{ detect, call, action }` : délais avec abort, erreurs isolées, `params` validés ; `call` → JSON d'une méthode, 4 Mo max, vérifié par son `result` ; `action` → terminal seulement, argv quoté par `shQuote`), `createPlugins` (liste, activation, import mémoïsé, lancé au démarrage pour les plugins activés ; `detect`, `call`, `action`), `killAll` (groupes d'`exec` encore vivants), `testPlugin` (même runner pour les tests, faux exécutables par `bins`), `tempDir` (dossier temporaire des tests, effacé à la sortie du process). | lance des process ; lit `plugins/*/package.json` ; écrit seulement `~/.vigie/plugins-data/<id>/` (création) |
| `plugins/<id>/` (hors `daemon/`) | Un plugin : `index.mjs` = `export default (vigie) => vigie.definePlugin({ id, session: { detect, methods, actions } })` (méthodes : JSON lu par son front ; actions : terminal décrit) ; `contract.mjs` = ses schémas zod (`result` des méthodes, `params`), partagés avec son front ; `ui/` = son composant Angular (décision 037, compilé avec l'app, listé par `scripts/plugin-uis.mjs`). Fonctions pures exportées pour ses tests (`index.test.mjs` via `testPlugin`). Livrés : `mise`, `xcode`, `npm`, `nx`. | par le SDK (`exec`), lecture du cwd ; écriture sous `vigie.dataDir` seulement |
| `claude-status.mjs` | Statut de Claude (décision 024) : `parseStatus` (pur : JSON quelconque → `{ indicator, incidents }`, 5 incidents max, noms tronqués à 200, lien limité à https `status.claude.com` / `stspg.io`), `fetchStatus` (ne rejette jamais : échec → `unknown` ; passe par `HTTPS_PROXY` s'il est déclaré, `http.setGlobalProxyFromEnv`, présent en Node 24). **Seul module qui fait lui-même une requête sortante** (l'autre sortie, décision 046, passe par le binaire `claude`). | réseau sortant : un GET |
| `hook.mjs`, `statusline.mjs` | Scripts lancés **par Claude Code**, jamais importés. Hooks en **commande** (décision 021, chemin par défaut) : `hook.mjs` ajoute chaque événement à `~/.vigie/spool.jsonl` ; la route `POST /api/hook` (hooks HTTP, même spool) reste dans le transport mais n'est pas branchée (le proxy du sandbox de Claude Code les refuse). `statusline.mjs` relaie la statusline de l'utilisateur et écrit `~/.vigie/limits/<session>.json` (logique pure dans `launch.mjs`, testée). Ils n'importent que `launch.mjs` et `paths.mjs` (`node:*` seulement), jamais le contrat. | oui |

## Dépendances autorisées (A → B : A peut importer B)

    server.mjs   → transport, store, launch, ingest (readNewLines, batchWatch), paths, platform, claude-status, plugins et git (killAll seulement, à l'arrêt)
    transport    → guard, launch, paths, platform, settings, git, files, projects, claude-config, plugins, ../contract/index.mjs   (le store est passé en argument, pas importé)
    plugins      → launch (shQuote), zod/mini, node:*
    plugins/*/**/*.{js,mjs} → node:* (sauf child_process, réseau, node:module) et ses fichiers ./… dont ./contract.mjs (back : tout module hors ui/, contract.mjs et tests ;
                             le SDK arrive en argument, process par vigie.exec ; leurs tests : ../../daemon/plugins.mjs)
    plugins/*/contract.mjs → zod/mini uniquement
    plugins/*/ui/**        → @vigie/plugin-sdk, @angular/*, @spartan-ng/helm/*, zod/mini, ../contract.mjs, ./x (TypeScript)   (+ @vigie/plugin-sdk/testing et vitest dans les specs)
                             liste d'autorisés vérifiée par ESLint (`eslint.config.mjs`, `pluginFront`) : tout autre import est refusé (app, SDK par chemin,
                             daemon, contrat de Vigie, autre plugin, `@ng-icons/*`, `rxjs`, un fichier `./x.js` / `.mjs` / `.cjs`…) ; aucun segment ne
                             commence par un point (`./a/../..` ou `@angular/core/../..` refusés) ; en plus `@angular/common/http(/*)`, `DomSanitizer`,
                             `bypassSecurityTrust*`, HTML de confiance (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`,
                             `createContextualFragment` sur tout objet, `x['innerHTML']`, `{ innerHTML: … }`, chaîne `'innerHTML'` / `'[innerHTML]'`
                             pour `host`, `@HostBinding` ou `setProperty`, `[innerHTML]` en gabarit, casse ignorée), `import()` dynamique, réseau direct
                             (`fetch`, `sendBeacon`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `Worker`, `SharedWorker`, par leur nom, comme propriété
                             de n'importe quel objet ou déstructurés), navigation (`open`, `location`, seuls ou sur `window` / `self` / `globalThis` / `document`)
    scripts/plugin-uis.mjs → daemon/plugins.mjs (readManifests), node:*   (outil de build ; `check()` : table à jour, une seule copie de @angular/core vue de ui/, plugins/ et chaque plugins/<id>/ui)
    contract     → zod/mini uniquement
    store        → ingest, usage, pricing, history, trace
    history      → usage, node:*
    trace        → ingest, node:path
    usage        → ingest, pricing, node:path
    claude-config → paths
    git          → paths, node:*
    files        → git, paths, ingest (excerpt), node:*
    projects     → git (headBranch), paths, node:*
    launch       → paths, node:path
    hook         → launch (spoolLine)
    statusline   → launch (userStatusLine, limitsReading), paths
    bin/vigie.mjs → daemon/platform, daemon/paths (claudeConfigDir), ../contract/index.mjs (valide le snapshot de `vigie status`)
    electron/main.mjs → daemon/platform, daemon/paths
    ingest, guard, pricing, platform, paths, settings, claude-status → node:* uniquement

Vérifié par ESLint (`eslint.config.mjs`) : le lint attrape les formes usuelles (import, propriété, déstructuration, forme calculée,
alias de module) ; un contournement délibéré reste à la relecture (voir « Non couvert »).
- partout (UI comprise, tests compris) : `server.mjs` et `zod` hors `zod/mini` (statique et `import()`) ; `require()` (l'ESM n'a pas de
  `require` : `no-undef`), sauf `require('electron')` dans un `.cjs` (seul `electron/preload.cjs` existe : une fenêtre sandboxée
  n'accepte pas l'ESM) ; `marked`
  hors de `ui/src/app/core/markdown.ts` (UI et fronts de plugins, `import()` compris : le Markdown passe par `renderMarkdown`, décision 044) ;
- imports par liste d'autorisés : `daemon/` (tests compris) n'importe que `node:*`, ses modules `./x.mjs` (sans sous-dossier ni `..`),
  `../contract/index.mjs`, `ws`, `node-pty`, `zod/mini` ; `bin/` et `electron/` que `node:*`, leurs fichiers, `../daemon/*.mjs`,
  `../contract/*.mjs` et `electron` (leurs fichiers en `.js` / `.mjs` / `.cjs`, eux-mêmes vérifiés) ; le back d'un plugin que `node:*` et ses fichiers `./….js` / `.mjs` hors de son `ui/` ; un contrat
  (`contract/`, `plugins/*/contract.mjs`) que `zod/mini` ; un fichier voisin hors de ces globs (`daemon/x.cjs`, `plugins/<id>/x.cjs`,
  `plugins/<id>/ui/x.mjs`) n'est donc importable ni par le daemon, ni par la CLI et l'app, ni par le back ou le front d'un plugin ;
- contrat (`**/contract/**`, `@vigie/contract`) importé dans `daemon/` hors de `transport.mjs` et des tests ;
- plateforme : aucune propriété `platform` lue (`process.platform`, `globalThis.process.platform`, `os.platform()`, `x['platform']`,
  `const { platform } = …`) dans `daemon/` (tests compris) hors de `platform.mjs`, dans le back des plugins, `contract/`, `scripts/` et tout `.cjs` ;
  dans les points d'entrée (`server.mjs`, `bin/`, `electron/`, `preload.cjs` compris), seulement `{ platform: process.platform }` (passé à
  `platform.mjs`) ; dans `daemon/` (hors `platform.mjs`), `bin/`, `electron/`, `scripts/` et le back des plugins : `os.type()`, imports nommés
  `platform` / `type` de `node:os` et `platform` de `node:process`, `node:os` et `node:process` importés sous un autre nom que `os` / `process` ;
- réseau sortant dans `daemon/`, `bin/`, `electron/`, `scripts/`, tout `.cjs` et le back des plugins, hors de `claude-status.mjs` : `https`, `http2`,
  `net`, `tls`, `dgram`, `dns` et `dns/promises`, client de `ws` ; `fetch`, `WebSocket`, `EventSource` (par leur nom ou par `globalThis` /
  `global`) ; `node:http` hors de `transport.mjs` et de `claude-status.mjs` ; dans `bin/` et `electron/`, en plus le `net` d'Electron (import
  nommé, `x.net`, déstructuration) et sa pile par une session ou une page (`x.fetch`, `x.downloadURL`, forme calculée et déstructuration
  comprises), et le `fetch` global n'y est permis que vers le daemon local, l'URL en gabarit qui commence par `${ORIGIN}`
  (`http://127.0.0.1:PORT` dans `bin/vigie.mjs` et `electron/main.mjs`) ; dans `transport.mjs`, `node:http` seulement sous le nom `http`, sans `request`, `get`, `Agent`, `ClientRequest`,
  `globalAgent` (import nommé, `http.x`, `http['x']` ou déstructuration) ;
- chargement hors import statique : `import()` dynamique dans `daemon/` hors de `plugins.mjs` et des tests (où seuls `server.mjs` et `zod`
  hors `zod/mini` sont refusés), dans `bin/`, `electron/`, `scripts/`, tout `.cjs`, dans le back et le front d'un plugin et dans un contrat ; `node:module` (`createRequire`) et `getBuiltinModule` (sur tout
  objet, déstructuré compris) dans `daemon/`, `bin/`, `electron/` et le back des plugins ; `getBuiltinModule` aussi dans `scripts/` et
  tout `.cjs` (`scripts/` garde `createRequire`, qui y résout `@angular/core`) ; `hook.mjs`, `statusline.mjs`, `launch.mjs`,
  `paths.mjs` qui importent autre chose que `node:*` et ces quatre modules ;
- back d'un plugin (`plugins/*/**/*.{js,mjs}` hors `ui/`, `contract.mjs` et tests) : en plus, `child_process` ;
- front d'un plugin : la liste d'autorisés et les interdits décrits plus haut (`plugins/*/ui/**`).

Non couvert par le lint (à tenir à la relecture) : les contournements délibérés en général (valeur passée par une variable ou une
fonction intermédiaire, `Reflect.get`, `eval` — que la CSP de l'UI refuse —, `inject(DOCUMENT).defaultView.open`…) ; ce que charge un `createRequire` de `scripts/` ; une décision d'OS prise sur une variable d'environnement propre à un système (`WSL_DISTRO_NAME`…)
hors de `platform.mjs` ; `open` ou `location` sur un autre objet que les globaux usuels dans le front d'un plugin.

Interdit : importer `server.mjs` ou `transport.mjs` depuis un autre module (les tests exceptés pour `transport`) ; tout cycle ;
importer `contract` depuis `hook.mjs` ou `statusline.mjs` (ils tournent depuis `app.asar.unpacked/daemon`, où `../contract` n'existe pas) ;
importer `zod` au lieu de `zod/mini` ; importer `@vigie/contract` par son nom de paquet côté daemon (electron-builder ne copie pas les liens de workspace) ;
I/O dans `usage`, `guard`, `launch`, `pricing`, `platform`, `paths` ; lire `process.platform` ailleurs que dans les points d'entrée (`server.mjs`, `bin/vigie.mjs`, `electron/main.mjs`), qui ne font que le passer à `platform.mjs` (`{ platform: process.platform }` ; `server.mjs` le donne au transport) ; décider selon l'OS hors de `platform.mjs` ; logique métier (filtre, règle, agrégat) dans `transport` ; lire `store.tracks` hors du store (seule exception : `store.tracks.size` dans le log de démarrage de `server.mjs`) ;
tout `fetch` / `http(s).request` sortant hors de `claude-status.mjs` (seul `fetch` de la CLI et d'Electron : vers le daemon local) ; `import()` dynamique hors du chargeur de plugins ; importer `claude-status` depuis le transport (il reçoit le dernier relevé par l'option `claudeStatus`) ;
plugin (back ou front) qui importe `daemon/`, `contract/`, `ui/src/**` ou un autre plugin ; HTML de confiance dans un front (`DomSanitizer`, `innerHTML`) ; une plateforme lue dans un plugin (disponibilité par la réponse de l'outil) ; écriture d'un plugin hors de `vigie.dataDir` ;
chaîne de shell dans un plugin (`vigie.terminal` prend un argv) ; `vigie.exec` sans `signal` dans `detect` ou une méthode.

## Chemin d'un événement (état vivant)

1. Session lancée par Vigie : `claude --session-id <id> --settings ~/.vigie/hooks.json` (`launch.claudeCommand`).
2. Claude Code lance `node hook.mjs` à chaque événement (hook en commande, décision 021) → une ligne `spoolLine` ajoutée à `~/.vigie/spool.jsonl`.
   `POST /api/hook` (hook HTTP, même ligne, aucun process lancé) existe encore mais n'est pas branché : le proxy du sandbox de Claude Code refuse les hooks HTTP.
3. `server.mjs` lit la suite du spool toutes les 500 ms (`ingest.readNewLines`) → `store.onHook` → dernier événement par session.
   En parallèle : `fs.watch` → `store.scanFiles` (seulement les transcripts nommés), et scan complet toutes les 5 s → `store.scan` → `ingest.readTrack` (incrémental, par offset).
4. Tout changement appelle `changed()` (transport) : regroupement 400 ms, puis `store.snapshot(terminaux)`
   → `{ type: 'snapshot', … }` poussé à tous les clients `/ws`. Un snapshot part aussi toutes les 15 s (états dépendant du temps).
   Le dernier statut de Claude (`claudeStatus`, relevé par `server.mjs` au démarrage puis toutes les 5 min, absent avant le premier) y est joint.
5. L'UI remplace son état (`ui/src/app/core/models.ts` : `Snapshot`).

## Chemin d'une requête de détail (à la demande)

UI → `GET /api/sessions/:id[/trace|/log?since=N|/cost|/plan|/config|/git|/git/file?path=…|/files|/files/read?path=…|/files/search?q=…&case=1|/plugins]`, `/api/plugins`, `/api/usage?days=N` (1 à 400, `UsageQuery`, absent = 14), `/api/projects?q=` (`ProjectsQuery` ; chemin tapé → ses sous-dossiers, sinon les récents ; chemins en `~/…`), `/api/search?q=…&case=1` (`SearchQuery`, recherche dans les sessions), `/api/settings` (servi par l'état du transport, pas par le store).
Tout paramètre d'URL passe un schéma du contrat (`LogQuery`, `ProjectsQuery`, `UsageQuery`, `FileQuery`, `SearchQuery`) → 400 avec son message.
→ transport : contrôle d'hôte puis d'origine (tout GET) → route → `store.detail` / `sessionTrace` / `sessionLog` / `sessionCost` / `sessionPlan` / `usageRows` / `searchSessions` / `recentDirs` (+ `projects.listProjects`),
ou `store.cwdOf(id)` puis l'adaptateur (`readClaudeConfig`, `readGitDiff`, `readWorktreeFile`, `listProjectFiles`, `readProjectFile`, `searchProjectFiles`) ou `plugins.detect` → JSON ; 404 si la session est inconnue.
UI → `POST /api/sessions/:id/plugins/:pid/call/:method` (`PluginCallBody` `{ params? }`, une lecture en POST : origine, content-type et préflight déjà en place, params en JSON libre) → `plugins.call` → 200 avec le JSON du plugin (`null` possible ; validé côté UI par le schéma du plugin).
Requête abandonnée (onglet fermé, nouvelle frappe : `res` fermé avant la fin de la réponse) : `abortOnClose(res)` annule le `signal` passé à `searchProjectFiles`,
`store.searchSessions` (qui rend `null` : rien n'est écrit), `plugins.call` et `suggestCommitMessage`.
Le snapshot reste léger et poussé ; tout ce qui est lourd ou propre à une session passe par HTTP.

## Sécurité : où vivent les règles

- Écoute sur 127.0.0.1 uniquement : `server.mjs` (`listen`).
- Hôte (`127.0.0.1:<port>` / `localhost:<port>`, anti DNS rebinding) : `guard.hostOk`, sur toute requête HTTP et tout upgrade (`transport`).
- Origine : tout POST, tout GET `/api/*` et tout WebSocket (`/ws`, `/pty/<id>`) refusent une origine étrangère (`transport`, `refused` / `originOk`) :
  `Origin` hors de `127.0.0.1:<port>` / `localhost:<port>` → 403 ; pour HTTP, `Sec-Fetch-Site` présent et ni `same-origin` ni `none` → 403 aussi
  (un GET same-origin du navigateur n'envoie pas `Origin`, mais une page étrangère qui déclenche un GET no-cors, `<img src>`, envoie `cross-site` ;
  la CLI et le process principal d'Electron n'envoient ni l'un ni l'autre). POST exige `content-type: application/json` (préflight CORS obligatoire).
  `localhost:4200` n'est accepté qu'avec `VIGIE_DEV=1` : `ng serve` relaie `/api`, `/ws` et `/pty` au daemon par `ui/proxy.conf.json`
  (`changeOrigin` réécrit le Host vers `127.0.0.1:4317`, donc `hostOk` passe ; l'`Origin` `http://localhost:4200` et `Sec-Fetch-Site: same-origin`
  du navigateur restent, acceptés par `originOk` et `siteOk` seulement en dev). Port fixe dans ce fichier : un `VIGIE_PORT` différent demande de l'éditer.
- Entrées : tout corps POST, tout paramètre d'URL et tout message `/pty` passent un schéma du contrat (`valid()` → 400 avec le message français du schéma ; message `/pty` invalide ignoré), après hôte, origine et content-type. Les POST sans paramètre (`/api/shutdown`, `/api/chat`, `/api/chat/:id/delete`, `…/delete`, `…/git/commit-message`, `/api/terminals/:id/close`) n'acceptent que `{}` (`EmptyBody` strict ; corps vide = `{}`). JSON illisible → 400, corps > 1 Mo → 413. Appels `pty.write` / `resize` sous try. Serveur : une erreur après `listen` est journalisée, jamais une sortie.
- Statiques : `guard.staticFile` (décodage, octet nul, sortie du dossier de l'UI). Tout fichier de l'UI part avec la CSP de la décision 044 (`guard.csp(port)`) :
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:<port> ws://localhost:<port>; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  Aucun script inline (le thème est un fichier de `ui/public/`). Une ressource qui n'y tient pas (wasm, `eval`) = nouvelle décision. Pas de CSP sous `ng serve`.
- Robustesse : handler HTTP et upgrade entièrement sous try ; chaque WebSocket a un écouteur `error` ; un message illisible est ignoré ; le snapshot diffusé par timer est sous try (journalisé) ; lecture du spool par `readNewLines` (jamais d'exception dans le timer de 500 ms).
- Commandes : le PTY exécute `$SHELL -l -c <commande de l'UI>` (à défaut le shell du compte, puis `/bin/sh`) (voulu, derrière le contrôle d'origine) ; l'injection de l'id et des hooks
  passe par `launch.claudeCommand` (`shQuote`) ; les commandes de `hooks.json` (node, `hook.mjs`, `statusline.mjs`) sont quotées par `shQuote` (un `$` ou un
  backtick d'un chemin n'est pas développé) ; `git` / `claude -p` par `git.run` : `spawn` sans shell, groupe détaché tué au délai (et au `signal` pour
  `claude -p` et ses git), SIGTERM d'abord (git retire son index.lock) puis SIGKILL 5 s plus tard ; stdin fermé pour git (un hook qui lit stdin ne bloque pas),
  le prompt pour claude (stdin sous écouteur `error` : un EPIPE ne tue pas le daemon). `server.mjs` appelle `git.killAll()` à l'arrêt (SIGTERM seul à
  chaque groupe vivant, le daemon sort juste après) : embarqué par Electron (utilityProcess) ou lancé par `vigie start`, le daemon n'a ni launchd ni
  systemd pour ramasser ses descendants. Environnement nettoyé (`cleanEnv`).
  `POST …/terminals` (`TerminalBody`, même schéma strict qu'`EmptyBody`) n'accepte que `{}` (un shell) ; tout autre champ, dont les `miseTask` / `xcode` d'avant les plugins, → 400 (décision 035).
  Plugins (décisions 034, 037) : les 5 routes (`GET /api/plugins`, `GET …/plugins`, `POST /api/plugins/:id`, `POST …/plugins/:pid/call/:method`,
  `POST …/plugins/:pid/actions/:aid`) contrôlent l'origine, GET compris (un plugin lance des outils). Corps validés par le contrat
  (`PluginToggleBody`, `PluginCallBody`, `PluginActionBody` strict : `values` d'avant la 037 → 400), puis par le schéma `params` de la méthode
  ou de l'action avant le handler ; sans schéma, le handler reçoit `{}` (rien de l'UI n'atteint le plugin sans être décrit). Réponse d'une
  méthode : `JSON.stringify` (non sérialisable → 500, `undefined` → `null`, > 4 Mo → 500), puis son `result` s'il existe (500 sinon) ;
  une action doit renvoyer `vigie.terminal(…)` (500 sinon). Un même nom ne peut pas être méthode et action. Délais avec abort : 3 s pour
  `detect` (au-delà, compté absent), 10 s par appel, `timeout` propre d'une méthode plafonné à 60 s (504) ; une action n'a pas de `timeout`
  (refusé par `definePlugin` : il serait ignoré, une action ne fait que décrire un terminal). Requête de méthode abandonnée (onglet fermé :
  `res` fermé avant la fin de la réponse) : le transport annule un `AbortController`, `run` le combine au délai (`AbortSignal.any`), le
  handler voit `signal.aborted` et `vigie.exec` tue l'outil. Exception d'un plugin : 500 sans
  faire tomber le daemon (`unhandledRejection` journalisé par `server.mjs` ; une exception synchrone hors appel, dans un timer, le tue encore : `ponytail:` dans `server.mjs`). Le plugin décrit un terminal par un argv (64 éléments,
  8 000 caractères, sans octet nul ni antislash, programme sans `-` en tête) ; le SDK quote chaque argument (`shQuote`) et seul le transport ouvre
  le PTY. `exec` : sans shell, stdin fermé, groupe détaché tué au délai (borné à 1 ms – 10 min) ; à l'arrêt (SIGTERM, SIGINT, `exit`), `server.mjs` appelle
  `killAll()`, qui tue les groupes encore vivants. Plugin désactivé : jamais importé ; plugin activé : importé au démarrage en tâche de fond,
  et s'il ne se charge pas, absent de `active()` (snapshot) avec son erreur dans `list()`. Un échec d'appel est journalisé une fois (par `run`).
  `settings.json` : un `plugins` hors contrat ne garde que ses entrées booléennes, le reste du fichier est conservé.
  Garanties des plugins livrés : mise détecte sans process (`hasProjectTasks` : `mise.toml`, `.mise.toml` et variantes `.local` / d'environnement,
  `mise/config.toml`, `.mise/config.toml`, `.config/mise.toml`, `.config/mise/config.toml` qui déclarent des tâches, ou dossier de tâches-fichiers,
  du cwd jusqu'au home exclu : la config globale n'ouvre pas l'onglet ; `.tool-versions` ignoré ; pas de badge), lit sans `MISE_YES`, hors ligne, jamais `--yes` / `--hidden`, relit la liste avant `mise run` (refus de `-…`),
  `mise trust` au clic seulement (effet assumé : mise écrit son état dans `~/.local/state/mise`, même en lecture) ; Xcode : regex du scheme et UDID UUID (`XcodeRunParams` / `XcodeCleanParams` de `plugins/xcode/contract.mjs`), conteneur et `scripts/` relus (lstat), DerivedData sous
  `~/.vigie/plugins-data/xcode/<sha256(cwd)[0:12]>`, `run` par `/bin/sh -c` script fixe, `xed` sans PTY (méthode `open`, 8 s < délai de la méthode).
  npm : aucun process en lecture (package.json, lockfiles, pnpm-workspace.yaml) ; gestionnaire par `packageManager`, sinon lockfile (remontée jusqu'au `.git`, 10 niveaux) ;
  workspaces par `fs.promises.glob` (motif absolu, `..` ou antislash refusé, node_modules et dossiers cachés exclus, realpath sous celui du cwd), 200 workspaces,
  package.json de 1 Mo, 3 Mo de scripts en octets de JSON (`truncated`) ; `run` relit tout, refuse un script en `-…` ou absent de la liste, argv fixe par gestionnaire, jamais npx.
  Nx : `nx graph --file=stdout` à l'ouverture de l'onglet seulement (jamais dans `detect` ; exécute le code du dépôt), 55 s, `NX_DAEMON=false`,
  `NX_NO_CLOUD=true`, `NX_WRAPPER_SKIP_INSTALL=true`, cache `NX_WORKSPACE_DATA_DIRECTORY` sous `~/.vigie/plugins-data/nx/<sha256(realpath cwd)[0:12]>` ;
  graphe borné à 3 Mo de projets en octets de JSON (`truncated`) ; `"analytics": true` dans nx.json → nx n'est pas lancé ; `node_modules/.bin/nx` sinon nx du PATH, jamais npx ; `run` relit nx.json, projet et cible
  passent `ID` (`plugins/nx/contract.mjs` : ni `:`, ni espace, ni antislash, ni `-` en tête).
  Autres exécutions par un shell, voulues : `statusline.mjs` relance la statusline d'origine de l'utilisateur (`execSync`, `bash` trouvé par le PATH) ;
  `electron/main.mjs` lit le PATH et `CLAUDE_CONFIG_DIR` du shell de connexion (`$SHELL` + `platform.LOGIN_SHELL_ENV_ARGS`, commande fixe, 5 s,
  SIGKILL ; valeurs lues entre octets nuls par `parseLoginShellEnv`, ce qu'un `.zshrc` affiche avant ou après est écarté ; un `CLAUDE_CONFIG_DIR`
  déjà dans l'environnement prime) ; le service (launchd / systemd) reçoit PATH, SHELL et `CLAUDE_CONFIG_DIR` (résolu par `paths.claudeConfigDir`)
  tels qu'au moment de `vigie install`, s'il est défini (une variable changée ensuite demande de relancer `vigie install`).
  Toutes les fenêtres de l'app (`web-contents-created` : principale, terminal détaché ouvert par `window.open`, suivantes) : `window.open` vers
  l'UI de Vigie (même origine exacte) ouvre une fenêtre de l'app, tout autre lien part dans le navigateur ; une navigation hors de l'UI est
  annulée et part dans le navigateur. `openExternal` n'ouvre que `http:` / `https:`. Une page qui bloque son déchargement (`beforeunload`,
  brouillon non enregistré) déclenche `will-prevent-unload` : Electron demande (« Quitter quand même » / « Rester », défaut « Rester ») au
  lieu de bloquer en silence. Sortie de l'app : `before-quit` demande confirmation s'il reste des terminaux du daemon embarqué ; le daemon
  n'est tué qu'à `will-quit` (toutes les fenêtres fermées), donc jamais après un « Rester », qui annule la sortie et remet la confirmation à zéro.
  Sortie refusée alors qu'aucune fenêtre n'est ouverte (Linux : dernière fenêtre fermée → `window-all-closed` → `app.quit()`) : la fenêtre est
  rouverte. Démarrage de l'app (décision 050) : elle lance toujours son propre daemon. Service installé (`platform.serviceFiles`, un fichier
  présent, même service arrêté) → message (« lance `vigie uninstall` ») et sortie, launchd / systemd relanceraient son daemon. Sinon, un
  daemon qui répond déjà sur le port : confirmation (« Quitter » par défaut / « Arrêter et continuer », avec le nombre de terminaux
  vivants ; sortie demandée pendant le dialogue → rien n'est arrêté), puis `POST /api/shutdown` (fetch du process principal : ni `Origin`
  ni `Sec-Fetch-Site`, la garde d'origine passe ; 3 s) et attente de l'arrêt (5 s, aussi après un échec autre que 404) ; refus → `app.quit()`
  sans message ; 404 (daemon d'avant la route) ou daemon toujours vivant → message, puis `app.quit()`. Relancer l'app (`second-instance`) ou cliquer sur son icône du Dock (`activate`, macOS) rouvre la fenêtre principale si elle
  est fermée (même si un terminal détaché reste ouvert), sinon la ramène au premier plan.
- Identifiants d'URL : `[\w-]+` ; noms de fichiers de relevé nettoyés (`[^\w-]` retiré).
- Dépôt de l'utilisateur : seuls `git.restoreFile`, `commitAll`, `createBranch` et `git.replaceFile` le modifient. `restoreFile` (efface un non suivi,
  restaure un fichier) refuse comme `replaceFile` un chemin dans la config globale de Claude (403). `commitAll`, `createBranch` et `restoreFile`
  écrivent dans `.git` : `writableRepo` refuse (403) un dépôt dont la racine ou le dossier git commun (`--git-common-dir`, worktree lié compris)
  est dans la config globale de Claude (`~/.claude` versionné). `replaceFile` sert
  l'onglet Diff (`writeWorktreeFile`, `POST …/git/write`) et l'explorateur (`files.writeProjectFile`, `POST …/files/write`).
  `POST …/git/restore` est refusé comme les deux écritures pendant que Claude travaille (`working` du transport : `store.idle`, sinon 409).
  Garde de l'écriture, dans l'ordre : `store.idle` (sinon 409 « Claude travaille ») ; appartenance (Diff : chemin présent dans
  `git status` et pas supprimé ; explorateur : chemin relatif, sans octet nul, qui ne remonte pas (`..`) et sans segment `.git`, casse
  ignorée ; fichiers ignorés par git acceptés, `.env` compris) ; `checkFile` : `lstat` = fichier ordinaire (ni lien, ni dossier, ni
  sous-module), `realpath` du fichier sous `realpath` de la racine (dépôt, sinon cwd), texte UTF-8 sans octet nul, ≤ 100 Ko ; `realpath`
  hors de la config globale de Claude (`git.underClaudeConfig` : `realpath` de `~/.claude`, `~/.claude.json` et `CLAUDE_CONFIG_DIR` s'il est défini ;
  sinon 403 « config Claude en lecture seule », pour les deux routes) ; empreinte sha256 lue par
  `GET …/git/file` ou `…/files/read` égale à celle du disque, vérifiée avant l'écriture puis rejouée juste avant (`rename` ou écriture) (sinon 412) ; fichier en lecture seule (`access` W_OK) : 403.
  Écriture atomique par défaut (temporaire `wx` dans le même dossier, mode conservé, `rename`) ; fichier à plusieurs liens physiques ou
  d'un autre propriétaire : `writeInPlace` (même inode, `O_NOFOLLOW`, empreinte relue sur le descripteur, non atomique).
- Réseau sortant, deux exceptions au « local uniquement » :
  - Décision 024 : `claude-status.mjs`, un GET en dur vers `status.claude.com`, sans cookie ni corps, `redirect: 'error'`, timeout 10 s, par le proxy
    `HTTPS_PROXY` de l'environnement du daemon s'il en déclare un (`http.setGlobalProxyFromEnv`, `NO_PROXY` honoré ; lancé par launchd, systemd ou le
    Finder, le daemon n'en a pas) ; réponse non fiable, réduite par `parseStatus` à une forme bornée (enum, 5 incidents, 200 caractères, liens https
    vers un hôte connu). L'IP de la machine est visible de Statuspage.
  - Décision 046 : suggestion de message de commit (`git.suggestCommitMessage`), **seulement sur clic** (`POST …/git/commit-message`), par le binaire
    `claude` de l'utilisateur (son compte ; le daemon ne fait aucune requête), `git.CLAUDE_ARGS` = `-p --no-session-persistence --tools ''
    --strict-mcp-config --setting-sources '' --model haiku`, lancé depuis `~/.vigie/commit-message` (dossier vide, créé au premier clic), jamais
    depuis le dépôt : ni CLAUDE.md, ni réglages, hooks ou MCP du projet ; ni réglages ni CLAUDE.md de l'utilisateur ; aucun serveur MCP. Restent ce
    que la CLI impose : réglages gérés de l'organisation (et leurs hooks), identifiants, état global `.claude.json`. Pas `--bare` (il coupe l'OAuth
    des abonnés). Contenu borné : diff (`--no-ext-diff --no-textconv` : ni programme de diff externe ni textconv, git-crypt compris ; lecture
    arrêtée au-delà de `3 × MAX_PROMPT_DIFF` octets, jamais d'échec sur un diff énorme) tronqué à `MAX_PROMPT_DIFF` caractères, noms (pas le
    contenu) des fichiers non suivis (200 et 20 000 caractères au plus, puis `[… N autres]`), 15 derniers titres de commit, lus par `git` dans le dépôt. L'élargir ou le déclencher sans clic = nouvelle décision.
  - Rien d'autre : l'UI ne sort jamais (CSP), la CLI et Electron ne parlent qu'au daemon local.
- Config globale de Claude Code (`~/.claude`, `~/.claude.json`, `CLAUDE_CONFIG_DIR`) : lecture seule, sauf effacement d'une discussion (`cwd` = `~/.vigie/chat`) :
  `store.purge` n'efface que si `store.isChat` est vrai (garde dans `purge` même : route, deuxième passe à 3 s et `purgeChats` au démarrage ;
  un vrai transcript qui partage l'id d'une discussion n'est jamais effacé). `purge` ne lève jamais : un effacement refusé (EACCES, EBUSY, claude
  qui écrit encore ; `maxRetries: 3`) est journalisé, la piste reste et la passe suivante réessaie (dossier des sous-agents d'abord, transcript ensuite). Rien d'autre n'écrit dedans ; `replaceFile` et `restoreFile` le refusent (403).

## Où ajouter quoi

- Nouveau champ lu dans un transcript : `ingest.applyRecord` + `ingest.test.mjs`.
- Nouvel état, agrégat ou règle de session : méthode du store + `store.test.mjs`. Consommation ou coût : `usage.mjs` + `usage.test.mjs`.
- Nouvelle route : `transport.mjs`, qui ne fait qu'appeler le store ou un adaptateur ; test dans `transport.test.mjs`.
- Nouvel outil externe : plugin `plugins/<id>/` (`package.json` avec `vigie: { api: 2, id, name, description }`, `index.mjs`, `contract.mjs`, `index.test.mjs` via `testPlugin`, `ui/index.ts` = son composant Angular), désactivé par défaut ; puis `node scripts/plugin-uis.mjs` et commiter `ui/src/app/core/plugin-uis.generated.ts` (`--check` en tête de `npm test` attrape l'oubli). Chaque méthode d'un plugin livré déclare son `result`. Adaptateur dédié du daemon seulement pour ce qui n'est pas un onglet de session.
- Comportement propre à un OS (chemin système, commande, service) : fonction pure dans `platform.mjs` + `platform.test.mjs` couvrant macOS et Linux (et WSL si ça diffère) ; l'appelant ne fait que l'effet.
- Nouveau fichier sur disque : sous `~/.vigie/` uniquement.
- Contrat : tout champ JSON ajouté ou modifié l'est dans `contract/index.mjs` (même optional/nullable que la sortie réelle), dans la sortie du daemon et dans le mock UI (`vigie.service.mock.ts`) dans la même tâche, toujours de façon additive. Chaque sortie a son `conforme(Schéma, …)` dans le test du module qui la produit (`store`, `git`, `claude-config`, `transport`).
- Nouvelle route POST (corps, même vide : `EmptyBody`) ou nouveau paramètre d'URL : schéma d'entrée dans `contract/index.mjs` + cas refusés dans `transport.test.mjs`.
- Nouveau chemin sous le home ou dans la config de Claude : `paths.mjs` (`expandHome`, `tildePath`, `claudeConfigDir`), jamais `~` ni `/` en dur.

## Packaging

- `zod` est une dépendance racine (embarquée par electron-builder) ; `contract/**` et `plugins/**` (sans `*.test.mjs` ni `plugins/*/ui/**`, compilé dans `ui/dist`) sont dans `build.files`. `plugins/` reste dans l'asar (importé par le daemon, jamais lancé par Claude Code) ; `plugins/<id>/contract.mjs` y est (le back l'importe). `scripts/` n'est pas embarqué.
- `build.files` exclut `zod/{src,v3}` et `zod/**/*.{cjs,d.ts,d.cts,d.mts,map}` : sans risque tant que tout passe par `zod/mini` en ESM.
- Les dépendances de `ui/` sont en `devDependencies`, sauf `@observablehq/plot` (en `dependencies` de `ui/package.json`, comme sur `main`) : l'UI entre dans l'app par `ui/dist` (le bundle, Plot compris) ; Angular n'y entre jamais. Que electron-builder copie aussi Plot dans le `node_modules` de l'app n'est pas vérifié ici.
