# Architecture du daemon

Pas de framework, pas de base, pas de couche d'abstraction : des modules de quelques fonctions, un sens de dépendance.
Source de vérité : les transcripts de Claude Code (`~/.claude/projects`) et le spool des hooks (`~/.vigie/spool.jsonl`).
Le store se reconstruit toujours depuis eux ; rien d'important ne vit seulement en mémoire.

## Modules

| Module | Rôle | I/O |
|---|---|---|
| `server.mjs` | Point d'entrée (npm start, launchd / systemd --user, Electron) : lit l'environnement, écrit `~/.vigie/hooks.json`, crée le store, enregistre l'historique de consommation (au démarrage avant la purge des discussions, puis toutes les 10 min), purge les discussions, lit le spool, arme watchers et timers, relève le statut de Claude toutes les 5 min, `listen` sur 127.0.0.1. Aucune route, aucune règle métier. | oui (câblage) |
| `transport.mjs` | `createTransport()` : HTTP, WebSocket, PTY, contrôle d'hôte et d'origine, statiques. Traduit requête → appel du store ou d'un adaptateur → JSON. Pas de `listen`, pas d'effet à l'import. Garde les réglages du daemon (`/api/settings`) et l'état des plugins (`plugins` de `settings.json`, lu avec `SettingsFile`, écrit par `POST /api/plugins/:id` seulement). Ouvre le PTY d'un terminal décrit par un plugin. | PTY, réseau, `~/.vigie/settings.json` |
| `store.mjs` | État en mémoire et agrégats : sessions, états, détail, trace, journal, discussions (`isChat`, `purgeChats`), dossiers récents, `cwdOf`, `idle` (Claude ne travaille pas : tour rendu ou terminé, aucun sous-agent actif). Lit `~/.vigie/hidden.json` et `~/.vigie/limits/` (`readReadings`, en gardant le pic de chaque fenêtre de 5 h). Historique de consommation `~/.vigie/usage.json` (décision 025) : lu une fois à la création (illisible → mis de côté en `usage.json.corrupt-<ts>`, jamais écrasé ; absent → premier scan sur 31 jours), écrit par `saveHistory` (tmp + rename, ne lève jamais) ; lignes d'une discussion sans titre, jamais de début de prompt archivé ; réécrit seulement s'il y a du neuf (ou une fois par heure). Coût d'une session au fil du temps (`sessionCost`). | lecture ; écriture limitée à `hidden.json`, `usage.json`, au ménage de `limits/` et à `purge` |
| `history.mjs` | Fichier d'historique `~/.vigie/usage.json` : `openHistory` (lecture une fois ; illisible → mis de côté, jamais écrasé ; absent → `seed`), `writeHistory` (tmp + rename). Le contenu est calculé par `usage.mjs`. | `usage.json` |
| `trace.mjs` | Trace d'une session en tours, pur : `buildTrace({ main, subs, summary, now })`. | aucune |
| `usage.mjs` | Consommation, pur : jour en cours, fenêtre de 5 h (estimée ou réelle à partir des relevés), lignes jour × session × modèle, consommation d'une session. Historique : `trackRows` (lignes d'une piste, clé `<session>/<fichier>`), `mergeRows` (une piste en mémoire remplace ses lignes archivées, coupe à 400 j), `sessionRows`, `validHistory` ; fenêtres closes `quotaBlocks` / `mergeWindows` (archive figée, jamais de chevauchement) ; série de coût `costSeries`. | aucune |
| `ingest.mjs` | Décodage des transcripts, pur, plus la lecture incrémentale du fichier qu'on lui confie (`readNewLines`). États (`deriveState`). | lecture du fichier passé |
| `guard.mjs`, `launch.mjs` | Fonctions pures du transport et de l'entrée : hôte, chemin statique, commande `claude`, contenu de `hooks.json`. | aucune |
| `pricing.mjs` | Tarifs, `costOf`. | aucune |
| `platform.mjs` | Point de plateforme unique (macOS, Linux, WSL), pur : `isWsl`, `managedSettingsFile`, `findOnPath` / `nodeVersionOk` (node du PATH pour les scripts lancés par Claude Code, au lieu d'Electron), `openUrlCommands`, `localeEnv` / `defaultLocale` (locale des PTY), `startupMethod`, `systemdUserDir`, contenus `launchdPlist` / `systemdUnit`. Plateforme, release et env injectés : les tests simulent Linux depuis un Mac. Utilisé aussi par `bin/vigie.mjs` et `electron/main.mjs`. | aucune |
| `contract/index.mjs` (workspace `@vigie/contract`) | Schémas zod (`zod/mini` uniquement) : miroir exact des sorties (dont dérive `ui/.../models.ts`) et schémas d'entrée (corps POST, messages `/pty`). Partagé par le daemon, les tests et l'UI. | aucune |
| `git.mjs`, `claude-config.mjs` | Adaptateurs : `git` et `claude` via `execFile`/`spawn` sans shell (sauf `headBranch`, qui lit `.git/HEAD` directement) ; lecture seule de la config Claude. | oui |
| `projects.mjs` | Sélecteur de projet (décision 029) : `projectKind` (pur : noms à la racine → `ios` / `node` / `rust` / `go` / `python` / `java` / null, iOS d'abord), `childDirs` (sous-dossiers non cachés du chemin tapé, 50 max), `describeDirs` (une `readdir` + `git.headBranch` par dossier, sans process ; dossier illisible → kind et branch null). | lecture |
| `files.mjs` | Adaptateur de l'explorateur : arbre du projet (`listProjectFiles` : `git ls-files` suivis + non suivis + ignorés, dossiers ignorés repliés ; hors dépôt, parcours en largeur sans suivre les liens, `node_modules` / `.git` repliés ; 20 000 entrées max), lecture et écriture de n'importe quel fichier texte du projet (`readProjectFile`, `writeProjectFile`) avec les gardes de `git.mjs` (`checkFile`, `replaceFile`) ; recherche de texte littéral (`searchProjectFiles` : dans un dépôt, suivis + non suivis seulement, jamais les ignorés ; hors dépôt, tout l'arbre de `listProjectFiles`, `.env` compris ; mêmes gardes que `checkFile`, sautées sans erreur : liens, fichiers hors de la racine par un dossier parent lien, binaires, non UTF-8, > `MAX_PATCH` ; 2 000 lignes max, annulable par `AbortSignal`). | oui |
| `plugins.mjs` | Plugins (décisions 034, 037), `API = 2` : `readManifests` (`plugins/*/package.json`, champ `vigie`, lecture synchrone sans import ; aussi lu par `scripts/plugin-uis.mjs`), `exec` (spawn sans shell, stdin fermé, groupe détaché tué au délai, au `signal` ou au-delà de `maxBuffer`, ne rejette jamais), `createSdk` (`definePlugin` : forme vérifiée au chargement, `z`, `exec`, `terminal`, `error`, `dataDir`), `loadPlugin` (runner `{ detect, call, action }` : délais avec abort, erreurs isolées, `params` validés ; `call` → JSON d'une méthode, 4 Mo max, vérifié par son `result` ; `action` → terminal seulement, argv quoté par `shQuote`), `createPlugins` (liste, activation, import mémoïsé, lancé au démarrage pour les plugins activés ; `detect`, `call`, `action`), `killAll` (groupes d'`exec` encore vivants), `testPlugin` (même runner pour les tests, faux exécutables par `bins`), `tempDir` (dossier temporaire des tests, effacé à la sortie du process). | lance des process ; lit `plugins/*/package.json` ; écrit seulement `~/.vigie/plugins-data/<id>/` (création) |
| `plugins/<id>/` (hors `daemon/`) | Un plugin : `index.mjs` = `export default (vigie) => vigie.definePlugin({ id, session: { detect, methods, actions } })` (méthodes : JSON lu par son front ; actions : terminal décrit) ; `contract.mjs` = ses schémas zod (`result` des méthodes, `params`), partagés avec son front ; `ui/` = son composant Angular (décision 037, compilé avec l'app, listé par `scripts/plugin-uis.mjs`). Fonctions pures exportées pour ses tests (`index.test.mjs` via `testPlugin`). Livrés : `mise`, `xcode`, `npm`, `nx`. | par le SDK (`exec`), lecture du cwd ; écriture sous `vigie.dataDir` seulement |
| `claude-status.mjs` | Statut de Claude (décision 024) : `parseStatus` (pur : JSON quelconque → `{ indicator, incidents }`, 5 incidents max, noms tronqués à 200, lien limité à https `status.claude.com` / `stspg.io`), `fetchStatus` (ne rejette jamais : échec → `unknown`). **Seul module qui sort de la machine.** | réseau sortant : un GET |
| `hook.mjs`, `statusline.mjs` | Scripts lancés **par Claude Code**, jamais importés. `statusline.mjs` écrit `~/.vigie/limits/<session>.json` ; `hook.mjs` n'est que le repli quand l'organisation interdit les hooks HTTP (écrit `~/.vigie/spool.jsonl`). `hook.mjs` importe `launch.mjs` (`spoolLine`), rien d'autre. | oui |

## Dépendances autorisées (A → B : A peut importer B)

    server.mjs   → transport, store, launch, platform, claude-status, plugins (killAll seulement, à l'arrêt)
    transport    → guard, launch, platform, git, files, projects, claude-config, plugins, ../contract/index.mjs   (le store est passé en argument, pas importé)
    plugins      → launch (shQuote), zod/mini, node:*
    plugins/*/index.mjs    → ./contract.mjs, node:* (le SDK arrive en argument ; leurs tests : ../../daemon/plugins.mjs)
    plugins/*/contract.mjs → zod/mini uniquement
    plugins/*/ui/**        → @vigie/plugin-sdk (+ /testing dans les specs), @angular/*, @spartan-ng/helm/*, @ng-icons/*, zod/mini, ../contract.mjs, ./…   (vitest dans les specs)
                             interdit, vérifié par ESLint (`eslint.config.mjs`, bloc `plugins/*/ui/**`) : `**/ui/src/**` (app et SDK par chemin), `**/daemon/**`,
                             `**/contract/**` et `@vigie/contract` (le contrat de Vigie ; `../contract.mjs` n'est pas sous un dossier `contract/`), `../../*` / `../../**`
                             (sortie de `plugins/<id>/`, donc un autre plugin) ; `DomSanitizer`, `bypassSecurityTrust*`, `innerHTML` / `outerHTML` et `[innerHTML]` en gabarit
    scripts/plugin-uis.mjs → daemon/plugins.mjs (readManifests), node:*   (outil de build ; `check()` : table à jour, une seule copie de @angular/core vue de ui/, plugins/ et chaque plugins/<id>/ui)
    contract     → zod/mini uniquement
    store        → ingest, usage, pricing, history, trace
    history      → usage, node:*
    trace        → ingest, node:path
    usage        → ingest, pricing, node:path
    claude-config → platform
    files        → git, node:*
    projects     → git (headBranch), node:*
    hook         → launch (spoolLine)
    ingest, guard, launch, pricing, platform, git, statusline, claude-status → node:* uniquement

Interdit : importer `server.mjs` ou `transport.mjs` depuis un autre module (les tests exceptés pour `transport`) ; tout cycle ;
importer `contract` depuis `hook.mjs` ou `statusline.mjs` (ils tournent depuis `app.asar.unpacked/daemon`, où `../contract` n'existe pas) ;
importer `zod` au lieu de `zod/mini` ; importer `@vigie/contract` par son nom de paquet côté daemon (electron-builder ne copie pas les liens de workspace) ;
I/O dans `usage`, `guard`, `launch`, `pricing`, `platform` ; brancher sur `process.platform` dans un autre module du daemon (on passe la valeur à `platform.mjs`) ; logique métier (filtre, règle, agrégat) dans `transport` ; lire `store.tracks` hors du store (seule exception : `store.tracks.size` dans le log de démarrage de `server.mjs`) ;
tout `fetch` / `http(s).request` sortant hors de `claude-status.mjs` ; importer `claude-status` depuis le transport (il reçoit le dernier relevé par l'option `claudeStatus`) ;
plugin (back ou front) qui importe `daemon/`, `contract/`, `ui/src/**` ou un autre plugin ; HTML de confiance dans un front (`DomSanitizer`, `innerHTML`) ; `process.platform` dans un plugin (disponibilité par la réponse de l'outil) ; écriture d'un plugin hors de `vigie.dataDir` ;
chaîne de shell dans un plugin (`vigie.terminal` prend un argv) ; `vigie.exec` sans `signal` dans `detect` ou une méthode.

## Chemin d'un événement (état vivant)

1. Session lancée par Vigie : `claude --session-id <id> --settings ~/.vigie/hooks.json` (`launch.claudeCommand`).
2. Claude Code poste l'événement à `POST /api/hook` (hook HTTP, aucun process lancé) → le transport ajoute une ligne `spoolLine` à `~/.vigie/spool.jsonl`. Repli si `allowedHttpHookUrls` géré l'interdit : `node hook.mjs` écrit la même ligne.
3. `server.mjs` lit la suite du spool toutes les 500 ms → `store.onHook` → dernier événement par session.
   En parallèle : `fs.watch` + scan toutes les 5 s → `store.scan` → `ingest.readTrack` (incrémental, par offset).
4. Tout changement appelle `changed()` (transport) : regroupement 400 ms, puis `store.snapshot(terminaux)`
   → `{ type: 'snapshot', … }` poussé à tous les clients `/ws`. Un snapshot part aussi toutes les 15 s (états dépendant du temps).
   Le dernier statut de Claude (`claudeStatus`, relevé par `server.mjs` au démarrage puis toutes les 5 min, absent avant le premier) y est joint.
5. L'UI remplace son état (`ui/src/app/core/models.ts` : `Snapshot`).

## Chemin d'une requête de détail (à la demande)

UI → `GET /api/sessions/:id[/trace|/log|/cost|/config|/git|/git/file?path=…|/files|/files/read?path=…|/files/search?q=…&case=1|/plugins]`, `/api/plugins`, `/api/usage?days=N` (1 à 400, `UsageQuery`, absent = 14), `/api/projects?q=` (origine contrôlée ; chemin tapé → ses sous-dossiers, sinon les récents ; chemins en `~/…`), `/api/settings` (servi par l'état du transport, pas par le store)
→ transport : contrôle d'hôte → route → `store.detail` / `sessionTrace` / `sessionLog` / `sessionCost` / `usageRows` / `recentDirs` (+ `projects.describeDirs`),
ou `store.cwdOf(id)` puis l'adaptateur (`readClaudeConfig`, `readGitDiff`, `readWorktreeFile`, `listProjectFiles`, `readProjectFile`) ou `plugins.detect` → JSON ; 404 si la session est inconnue.
UI → `POST /api/sessions/:id/plugins/:pid/call/:method` (`PluginCallBody` `{ params? }`, une lecture en POST : origine, content-type et préflight déjà en place, params en JSON libre) → `plugins.call` → 200 avec le JSON du plugin (`null` possible ; validé côté UI par le schéma du plugin).
Le snapshot reste léger et poussé ; tout ce qui est lourd ou propre à une session passe par HTTP.

## Sécurité : où vivent les règles

- Écoute sur 127.0.0.1 uniquement : `server.mjs` (`listen`).
- Hôte (`127.0.0.1:<port>` / `localhost:<port>`, anti DNS rebinding) : `guard.hostOk`, sur toute requête HTTP et tout upgrade (`transport`).
- Origine : tout POST, tout WebSocket (`/ws`, `/pty/<id>`) et les GET de l'explorateur (`/files`, `/files/read`, `/files/search`, qui lisent n'importe quel fichier du projet), ceux des plugins (lancent des outils) et `/api/projects` (sonde le disque) refusent une origine étrangère (`transport`, `originOk`) ;
  POST exige `content-type: application/json` (préflight CORS obligatoire). `localhost:4200` n'est accepté qu'avec `VIGIE_DEV=1`.
- Entrées : tout corps POST et tout message `/pty` passent un schéma du contrat (`valid()` → 400 avec le message français du schéma ; message `/pty` invalide ignoré), après hôte, origine et content-type. JSON illisible → 400, corps > 1 Mo → 413. Appels `pty.write` / `resize` sous try.
- Statiques : `guard.staticFile` (décodage, octet nul, sortie du dossier de l'UI).
- Robustesse : handler HTTP et upgrade entièrement sous try ; chaque WebSocket a un écouteur `error` ; un message illisible est ignoré.
- Commandes : le PTY exécute `$SHELL -l -c <commande de l'UI>` (à défaut le shell du compte, puis `/bin/sh`) (voulu, derrière le contrôle d'origine) ; l'injection de l'id et des hooks
  passe par `launch.claudeCommand` (`shQuote`) ; `git` / `claude -p` via `execFile` / `spawn` sans shell. Environnement nettoyé (`cleanEnv`).
  `POST …/terminals` (`TerminalBody` strict) n'accepte que `{}` (un shell) ; tout autre champ, dont les `miseTask` / `xcode` d'avant les plugins, → 400 (décision 035).
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
  Seule autre exécution par un shell : `statusline.mjs` relance la statusline d'origine de l'utilisateur (`execSync`, `bash` trouvé par le PATH), voulu.
- Identifiants d'URL : `[\w-]+` ; noms de fichiers de relevé nettoyés (`[^\w-]` retiré).
- Dépôt de l'utilisateur : seuls `git.restoreFile`, `commitAll`, `createBranch` et `git.replaceFile` le modifient. `replaceFile` sert
  l'onglet Diff (`writeWorktreeFile`, `POST …/git/write`) et l'explorateur (`files.writeProjectFile`, `POST …/files/write`).
  Garde de l'écriture, dans l'ordre : `store.idle` (sinon 409 « Claude travaille ») ; appartenance (Diff : chemin présent dans
  `git status` et pas supprimé ; explorateur : chemin relatif, sans octet nul, qui ne remonte pas (`..`) et sans segment `.git`, casse
  ignorée ; fichiers ignorés par git acceptés, `.env` compris) ; `checkFile` : `lstat` = fichier ordinaire (ni lien, ni dossier, ni
  sous-module), `realpath` du fichier sous `realpath` de la racine (dépôt, sinon cwd), texte UTF-8 sans octet nul, ≤ 100 Ko ; `realpath`
  hors de `realpath(<home>/.claude)` (sinon 403 « config Claude en lecture seule », pour les deux routes) ; empreinte sha256 lue par
  `GET …/git/file` ou `…/files/read` égale à celle du disque, vérifiée avant l'écriture puis rejouée juste avant (`rename` ou écriture) (sinon 412) ; fichier en lecture seule (`access` W_OK) : 403.
  Écriture atomique par défaut (temporaire `wx` dans le même dossier, mode conservé, `rename`) ; fichier à plusieurs liens physiques ou
  d'un autre propriétaire : `writeInPlace` (même inode, `O_NOFOLLOW`, empreinte relue sur le descripteur, non atomique).
- Réseau sortant (décision 024) : seul `claude-status.mjs`, un GET en dur vers `status.claude.com`, sans cookie ni corps, `redirect: 'error'`, timeout 10 s ;
  réponse non fiable, réduite par `parseStatus` à une forme bornée (enum, 5 incidents, 200 caractères, liens https vers un hôte connu). L'IP de la machine est visible de Statuspage.
- `~/.claude` : lecture seule, sauf effacement d'une discussion (`cwd` = `~/.vigie/chat`) : `store.isChat` garde la route, `store.purge` efface,
  `store.purgeChats` au démarrage. Rien d'autre n'écrit sous `~/.claude` ; `replaceFile` le refuse explicitement (403).

## Où ajouter quoi

- Nouveau champ lu dans un transcript : `ingest.applyRecord` + `ingest.test.mjs`.
- Nouvel état, agrégat ou règle de session : méthode du store + `store.test.mjs`. Consommation ou coût : `usage.mjs` + `usage.test.mjs`.
- Nouvelle route : `transport.mjs`, qui ne fait qu'appeler le store ou un adaptateur ; test dans `transport.test.mjs`.
- Nouvel outil externe : plugin `plugins/<id>/` (`package.json` avec `vigie: { api: 2, id, name, description }`, `index.mjs`, `contract.mjs`, `index.test.mjs` via `testPlugin`, `ui/index.ts` = son composant Angular), désactivé par défaut ; puis `node scripts/plugin-uis.mjs` et commiter `ui/src/app/core/plugin-uis.generated.ts` (`--check` en tête de `npm test` attrape l'oubli). Chaque méthode d'un plugin livré déclare son `result`. Adaptateur dédié du daemon seulement pour ce qui n'est pas un onglet de session.
- Comportement propre à un OS (chemin système, commande, service) : fonction pure dans `platform.mjs` + `platform.test.mjs` couvrant macOS et Linux (et WSL si ça diffère) ; l'appelant ne fait que l'effet.
- Nouveau fichier sur disque : sous `~/.vigie/` uniquement.
- Contrat : tout champ JSON ajouté ou modifié l'est dans `contract/index.mjs` (même optional/nullable que la sortie réelle), dans la sortie du daemon et dans le mock UI (`vigie.service.mock.ts`) dans la même tâche, toujours de façon additive. Chaque sortie a son `conforme(Schéma, …)` dans le test du module qui la produit (`store`, `git`, `claude-config`, `transport`).
- Nouvelle route POST : schéma d'entrée dans `contract/index.mjs` + cas refusés dans `transport.test.mjs`.

## Packaging

- `zod` est une dépendance racine (embarquée par electron-builder) ; `contract/**` et `plugins/**` (sans `*.test.mjs` ni `plugins/*/ui/**`, compilé dans `ui/dist`) sont dans `build.files`. `plugins/` reste dans l'asar (importé par le daemon, jamais lancé par Claude Code) ; `plugins/<id>/contract.mjs` y est (le back l'importe). `scripts/` n'est pas embarqué.
- `build.files` exclut `zod/{src,v3}` et `zod/**/*.{cjs,d.ts,d.cts,d.mts,map}` : sans risque tant que tout passe par `zod/mini` en ESM.
- Les dépendances de `ui/` sont en `devDependencies` : seul `ui/dist` entre dans l'app, jamais Angular.
