# Architecture du daemon

Pas de framework, pas de base, pas de couche d'abstraction : des modules de quelques fonctions, un sens de dépendance.
Source de vérité : les transcripts de Claude Code (`~/.claude/projects`) et le spool des hooks (`~/.vigie/spool.jsonl`).
Le store se reconstruit toujours depuis eux ; rien d'important ne vit seulement en mémoire.

## Modules

| Module | Rôle | I/O |
|---|---|---|
| `server.mjs` | Point d'entrée (npm start, launchd / systemd --user, Electron) : lit l'environnement, écrit `~/.vigie/hooks.json`, crée le store, enregistre l'historique de consommation (au démarrage avant la purge des discussions, puis toutes les 10 min), purge les discussions, lit le spool, arme watchers et timers, relève le statut de Claude toutes les 5 min, `listen` sur 127.0.0.1. Aucune route, aucune règle métier. | oui (câblage) |
| `transport.mjs` | `createTransport()` : HTTP, WebSocket, PTY, contrôle d'hôte et d'origine, statiques. Traduit requête → appel du store ou d'un adaptateur → JSON. Pas de `listen`, pas d'effet à l'import. Garde les réglages du daemon (`/api/settings`). | PTY, réseau, `~/.vigie/settings.json` |
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
| `mise.mjs` | Adaptateur mise : `parseMiseTasks` (pur : sortie de `mise tasks ls --json` → tâches, chemins en relatif / `~/…`, jamais `env`, `secrets`, `tools`), `readMiseTasks` (`execFile` sans shell, stdin fermé, timeout 5 s, ne rejette jamais : mise absent, dossier disparu, config non approuvée → `untrusted`, sortie illisible). | oui (lance `mise`) |
| `xcode.mjs` | Adaptateur Xcode (décision 030). Pur : `pickContainer` (workspace, sinon projet, sinon `Package.swift` ; noms hors `^[\w .+-]+\.(xcworkspace|xcodeproj)$` ignorés), `containerArgs`, `parseSchemes`, `parseSimulators` (iOS seulement), `derivedDataDir` (`~/.vigie/xcode/<sha256(cwd)[0:12]>`), `xcodeCommand` / `scriptCommand` (chaînes pour le PTY, tout par `shQuote`). I/O, ne rejettent jamais : `readXcodeProject` (une `readdir` + `scripts/`, sans process), `readXcodeTargets` (`xcodebuild -list -json -disableAutomaticPackageResolution` 30 s et `xcrun simctl list devices available -j` 10 s, en parallèle ; ENOENT ou « requires Xcode » / « unable to find utility » → `available: false`), `openInXcode` (`xed`, 10 s). Process par `spawn` détaché (groupe à part) : timeout et sortie > 8 Mo tuent tout le groupe (`kill(-pid)`), petits-enfants compris. Disponibilité déduite de la réponse de l'outil, jamais de `process.platform`. | oui (lance `xcodebuild`, `xcrun`, `xed`) |
| `claude-status.mjs` | Statut de Claude (décision 024) : `parseStatus` (pur : JSON quelconque → `{ indicator, incidents }`, 5 incidents max, noms tronqués à 200, lien limité à https `status.claude.com` / `stspg.io`), `fetchStatus` (ne rejette jamais : échec → `unknown`). **Seul module qui sort de la machine.** | réseau sortant : un GET |
| `hook.mjs`, `statusline.mjs` | Scripts lancés **par Claude Code**, jamais importés. `statusline.mjs` écrit `~/.vigie/limits/<session>.json` ; `hook.mjs` n'est que le repli quand l'organisation interdit les hooks HTTP (écrit `~/.vigie/spool.jsonl`). `hook.mjs` importe `launch.mjs` (`spoolLine`), rien d'autre. | oui |

## Dépendances autorisées (A → B : A peut importer B)

    server.mjs   → transport, store, launch, platform, claude-status
    transport    → guard, launch, platform, git, files, mise, projects, xcode, claude-config, ../contract/index.mjs   (le store est passé en argument, pas importé)
    contract     → zod/mini uniquement
    store        → ingest, usage, pricing, history, trace
    history      → usage, node:*
    trace        → ingest, node:path
    usage        → ingest, pricing, node:path
    claude-config → platform
    files        → git, node:*
    projects     → git (headBranch), node:*
    hook         → launch (spoolLine)
    xcode        → launch (shQuote), node:*
    ingest, guard, launch, pricing, platform, git, mise, statusline, claude-status → node:* uniquement

Interdit : importer `server.mjs` ou `transport.mjs` depuis un autre module (les tests exceptés pour `transport`) ; tout cycle ;
importer `contract` depuis `hook.mjs` ou `statusline.mjs` (ils tournent depuis `app.asar.unpacked/daemon`, où `../contract` n'existe pas) ;
importer `zod` au lieu de `zod/mini` ; importer `@vigie/contract` par son nom de paquet côté daemon (electron-builder ne copie pas les liens de workspace) ;
I/O dans `usage`, `guard`, `launch`, `pricing`, `platform` ; brancher sur `process.platform` dans un autre module du daemon (on passe la valeur à `platform.mjs`) ; logique métier (filtre, règle, agrégat) dans `transport` ; lire `store.tracks` hors du store (seule exception : `store.tracks.size` dans le log de démarrage de `server.mjs`) ;
tout `fetch` / `http(s).request` sortant hors de `claude-status.mjs` ; importer `claude-status` depuis le transport (il reçoit le dernier relevé par l'option `claudeStatus`).

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

UI → `GET /api/sessions/:id[/trace|/log|/cost|/config|/git|/git/file?path=…|/files|/files/read?path=…|/files/search?q=…&case=1|/mise|/xcode|/xcode/targets]`, `/api/usage?days=N` (1 à 400, `UsageQuery`, absent = 14), `/api/projects?q=` (origine contrôlée ; chemin tapé → ses sous-dossiers, sinon les récents ; chemins en `~/…`), `/api/settings` (servi par l'état du transport, pas par le store)
→ transport : contrôle d'hôte → route → `store.detail` / `sessionTrace` / `sessionLog` / `sessionCost` / `usageRows` / `recentDirs` (+ `projects.describeDirs`),
ou `store.cwdOf(id)` puis l'adaptateur (`readClaudeConfig`, `readGitDiff`, `readWorktreeFile`, `listProjectFiles`, `readProjectFile`, `readMiseTasks`, `readXcodeProject`, `readXcodeTargets`) → JSON ; 404 si la session est inconnue.
Le snapshot reste léger et poussé ; tout ce qui est lourd ou propre à une session passe par HTTP.

## Sécurité : où vivent les règles

- Écoute sur 127.0.0.1 uniquement : `server.mjs` (`listen`).
- Hôte (`127.0.0.1:<port>` / `localhost:<port>`, anti DNS rebinding) : `guard.hostOk`, sur toute requête HTTP et tout upgrade (`transport`).
- Origine : tout POST, tout WebSocket (`/ws`, `/pty/<id>`) et les GET de l'explorateur (`/files`, `/files/read`, `/files/search`, qui lisent n'importe quel fichier du projet) `/mise` (lire une config mise approuvée peut exécuter ses templates), `/xcode` et `/xcode/targets` (sondent le disque, lancent xcodebuild) et `/api/projects` (sonde le disque) refusent une origine étrangère (`transport`, `originOk`) ;
  POST exige `content-type: application/json` (préflight CORS obligatoire). `localhost:4200` n'est accepté qu'avec `VIGIE_DEV=1`.
- Entrées : tout corps POST et tout message `/pty` passent un schéma du contrat (`valid()` → 400 avec le message français du schéma ; message `/pty` invalide ignoré), après hôte, origine et content-type. JSON illisible → 400, corps > 1 Mo → 413. Appels `pty.write` / `resize` sous try.
- Statiques : `guard.staticFile` (décodage, octet nul, sortie du dossier de l'UI).
- Robustesse : handler HTTP et upgrade entièrement sous try ; chaque WebSocket a un écouteur `error` ; un message illisible est ignoré.
- Commandes : le PTY exécute `$SHELL -l -c <commande de l'UI>` (à défaut le shell du compte, puis `/bin/sh`) (voulu, derrière le contrôle d'origine) ; l'injection de l'id et des hooks
  passe par `launch.claudeCommand` (`shQuote`) ; `git` / `claude -p` via `execFile` / `spawn` sans shell. Environnement nettoyé (`cleanEnv`).
  mise : la liste (`GET …/mise`) passe par `readMiseTasks` avec un env calculé une fois (`cleanEnv` sans `MISE_YES`, plus `MISE_OFFLINE=1`,
  `MISE_HIDE_UPDATE_WARNING=1`), jamais `--yes` ni `--hidden`. `POST …/terminals` (`TerminalBody`) lance dans le PTY `mise run '<nom>'` seulement
  si le nom (ou un alias) figure dans la liste relue à l'instant, et `mise trust` seulement sur `miseTrust: true` (clic de l'utilisateur) ;
  jamais de `mise trust` automatique. Effet de bord assumé : mise écrit son propre état dans `~/.local/state/mise` (configs suivies), même en lecture.
  `POST …/terminals` accepte au plus une action (`miseTask`, `miseTrust`, `xcode`, `script`), sinon 400. Xcode : le conteneur est relu
  (`readXcodeProject`, sinon 400 « Pas un projet Xcode »), le scheme passe la regex du contrat (pas de `-` en tête, ni caractère de
  contrôle, ni `\` ni `'` : sous fish `\'` sort des guillemets de `shQuote`, POSIX) puis `shQuote`, sans relecture de la liste (xcodebuild -list est trop lent) ; l'UDID est un UUID ; DerivedData sous
  `~/.vigie/xcode`. `run` passe par `/bin/sh -c '<script fixe>' vigie <args quotés>` (fish ne comprend pas `VAR=$(…)`).
  `script` : nom présent dans `scripts/` relu à l'instant (fichier ordinaire, pas un lien, non caché), sinon 400 « Script inconnu ».
  `POST …/xcode/open` lance `xed` par `execFile`, sans PTY.
  Seule autre exécution par un shell : `statusline.mjs` relance la statusline d'origine de l'utilisateur (`execSync`, `bash` trouvé par le PATH), voulu.
- Identifiants d'URL : `[\w-]+` ; noms de fichiers de relevé nettoyés (`[^\w-]` retiré).
- Dépôt de l'utilisateur : seuls `git.restoreFile`, `commitAll`, `createBranch` et `git.replaceFile` le modifient. `replaceFile` sert
  l'onglet Diff (`writeWorktreeFile`, `POST …/git/write`) et l'explorateur (`files.writeProjectFile`, `POST …/files/write`).
  Garde de l'écriture, dans l'ordre : `store.idle` (sinon 409 « Claude travaille ») ; appartenance (Diff : chemin présent dans
  `git status` et pas supprimé ; explorateur : chemin relatif, sans octet nul, qui ne remonte pas (`..`) et sans segment `.git`, casse
  ignorée ; fichiers ignorés par git acceptés, `.env` compris) ; `checkFile` : `lstat` = fichier ordinaire (ni lien, ni dossier, ni
  sous-module), `realpath` du fichier sous `realpath` de la racine (dépôt, sinon cwd), texte UTF-8 sans octet nul, ≤ 100 Ko ; `realpath`
  hors de `realpath(<home>/.claude)` (sinon 403 « config Claude en lecture seule », pour les deux routes) ; empreinte sha256 lue par
  `GET …/git/file` ou `…/files/read` égale à celle du disque, vérifiée avant l'écriture et juste avant le `rename` (sinon 412).
  Écriture atomique (temporaire `wx` dans le même dossier, mode conservé, `rename`).
- Réseau sortant (décision 024) : seul `claude-status.mjs`, un GET en dur vers `status.claude.com`, sans cookie ni corps, `redirect: 'error'`, timeout 10 s ;
  réponse non fiable, réduite par `parseStatus` à une forme bornée (enum, 5 incidents, 200 caractères, liens https vers un hôte connu). L'IP de la machine est visible de Statuspage.
- `~/.claude` : lecture seule, sauf effacement d'une discussion (`cwd` = `~/.vigie/chat`) : `store.isChat` garde la route, `store.purge` efface,
  `store.purgeChats` au démarrage. Rien d'autre n'écrit sous `~/.claude` ; `replaceFile` le refuse explicitement (403).

## Où ajouter quoi

- Nouveau champ lu dans un transcript : `ingest.applyRecord` + `ingest.test.mjs`.
- Nouvel état, agrégat ou règle de session : méthode du store + `store.test.mjs`. Consommation ou coût : `usage.mjs` + `usage.test.mjs`.
- Nouvelle route : `transport.mjs`, qui ne fait qu'appeler le store ou un adaptateur ; test dans `transport.test.mjs`.
- Nouvel outil externe : adaptateur dédié, `execFile` sans shell, chemins validés.
- Comportement propre à un OS (chemin système, commande, service) : fonction pure dans `platform.mjs` + `platform.test.mjs` couvrant macOS et Linux (et WSL si ça diffère) ; l'appelant ne fait que l'effet.
- Nouveau fichier sur disque : sous `~/.vigie/` uniquement.
- Contrat : tout champ JSON ajouté ou modifié l'est dans `contract/index.mjs` (même optional/nullable que la sortie réelle), dans la sortie du daemon et dans le mock UI (`vigie.service.mock.ts`) dans la même tâche, toujours de façon additive. Chaque sortie a son `conforme(Schéma, …)` dans le test du module qui la produit (`store`, `git`, `claude-config`, `transport`).
- Nouvelle route POST : schéma d'entrée dans `contract/index.mjs` + cas refusés dans `transport.test.mjs`.

## Packaging

- `zod` est une dépendance racine (embarquée par electron-builder) ; `contract/**` est dans `build.files`.
- `build.files` exclut `zod/{src,v3}` et `zod/**/*.{cjs,d.ts,d.cts,d.mts,map}` : sans risque tant que tout passe par `zod/mini` en ESM.
- Les dépendances de `ui/` sont en `devDependencies` : seul `ui/dist` entre dans l'app, jamais Angular.
