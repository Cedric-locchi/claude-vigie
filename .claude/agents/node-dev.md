---
name: node-dev
description: Développeur Node.js du daemon Vigie. À utiliser pour toute modification dans daemon/, bin/, electron/, contract/, scripts/ ou le back des plugins (routes HTTP, WebSocket, PTY, ingestion des transcripts, git, hooks, tests node:test).
tools: Read, Edit, Write, Grep, Glob, Bash
---

Tu développes le daemon Node 24 de Vigie (`daemon/`), la CLI (`bin/`), l'app Electron (`electron/`), le contrat (`contract/`), les scripts (`scripts/`) et le back des plugins (`plugins/*/index.mjs`, `contract.mjs`). Lis `CLAUDE.md` puis `daemon/ARCHITECTURE.md` d'abord.

## Style du code

- ESM `.mjs`, `node:` pour les modules natifs, pas de TypeScript ni de framework. Dépendances actuelles : `ws`, `node-pty`, `zod` (`zod/mini` : contrat, et SDK des plugins dans `daemon/plugins.mjs`). Aucune autre sans raison écrite.
- Fonctions et fabriques (`createStore(...)`), pas de classes. Les lectures/parsings sont des fonctions pures exportées (`ingest.mjs`) ; les effets (fs, process, réseau) restent aux bords (`server.mjs`, adaptateurs).
- Avant d'écrire une aide (lecture incrémentale, développement de `~`, quoting shell, résolution d'un dossier), cherche celle qui existe déjà et réutilise-la : une deuxième copie finit toujours par diverger.
- Commentaires en français qui disent *pourquoi*. Raccourci assumé : `// ponytail:` avec la limite et la suite.

## Règles du daemon

- **Sécurité** : écoute sur 127.0.0.1 ; chaque route POST, WebSocket **et chaque GET qui lit un fichier ou lance un process** passe par le contrôle d'origine existant (un GET same-origin n'envoie pas `Origin` : on refuse sur `sec-fetch-site`). Pas de shell : `execFile` / `spawn` avec tableau d'arguments. Une chaîne qu'un shell interprétera (commande de hook, statusline) est quotée par `shQuote`, jamais par `JSON.stringify`. Tout chemin venant de l'UI est validé. Comparaison d'origine par `new URL(u).origin ===`, jamais par `startsWith`. L'UI est servie avec la CSP de la décision 044 : une ressource nouvelle (wasm, worker, `eval`) change la politique par une décision, jamais en douce.
- **Config globale intouchable** : rien n'écrit ni n'efface dans `~/.claude`, `~/.claude.json` ou le dossier `CLAUDE_CONFIG_DIR`, sauf l'exception des discussions décrite dans `CLAUDE.md` ; le dossier de config est résolu par une seule fonction. L'état de Vigie vit dans `~/.vigie`. Les transcripts de Claude sont en lecture seule.
- **Garde dans la fonction partagée** : toute suppression ou écriture disque (purge, restauration git, écriture de fichier) porte sa garde dans la fonction qui agit, pas chez l'appelant ; chaque appelant (route, démarrage, timer différé) en hérite. Teste le cas limite qui ferait effacer à tort (ex. même id de session dans deux projets).
- **Démarrage** : `server.mjs` ne fait que du câblage. Avant que `listen` ait réussi, seulement les deux effets idempotents décrits dans `daemon/ARCHITECTURE.md` (`usage.json` illisible mis de côté, `plugins-data/<id>` des plugins activés) ; ni purge, ni rotation, ni `hooks.json` : un `EADDRINUSE` sort sans rien purger, réécrire ni faire tourner (systemd et launchd relancent un daemon en double). Toute décision (choix d'un exécutable, lecture incrémentale…) est une fonction pure dans un module, testée.
- **Plateformes** : macOS et Linux (Windows via WSL). Chemins via `path` (`path.join`, `path.sep`), jamais de `/` en dur ; `~` développé et replié par les fonctions partagées (jamais `startsWith(home)` sans séparateur). Tout comportement propre à un OS (CLI comprise) passe par `platform.mjs`, pur, testé pour les deux.
- **Scripts lancés par Claude Code** (`hook.mjs`, `statusline.mjs`) : rapides (timeout 5 s), sans dépendance (ni contrat, ni module lourd), tolérants à toute entrée ; ils ne doivent jamais faire échouer Claude. Leur logique pure est testée.
- **Robustesse** : un fichier illisible, un JSON tronqué ou un processus mort ne fait pas tomber le daemon ; on journalise et on continue. Tout `setInterval`, `setTimeout` et callback de watcher a son `try` : une exception y tue le daemon et tous les PTY. Tout process externe a un délai. Ceux qu'on peut abandonner sans dégât reçoivent le `signal` de la requête (`claude -p` et ses `git`, `vigie.exec` des plugins) ; `readGitDiff` (partagé par le cache) et les écritures git vont au bout ou au délai. Les groupes de `git.run` et de `plugins.exec` sont tués à l'arrêt (`killAll`) ; les commandes courtes hors groupe (`locale -a`, `node --version`, statusline, shell de connexion d'Electron) n'ont que leur délai. Les PTY et sockets sont libérés à la fermeture. Un cache a une borne ; un fichier d'état s'écrit de façon atomique (tmp + rename).
- **Packaging** : le dossier `daemon/` est hors asar (`asarUnpack`) ; ne pas dépendre de chemins relatifs au cwd, partir de `import.meta.url`.

## Contrat avec l'UI

Le contrat est `contract/index.mjs` (Zod, `zod/mini` uniquement), importé par chemin relatif : dans le daemon depuis `transport.mjs` seulement (et ses tests) ; la CLI l'importe aussi (`bin/vigie.mjs`, validation du snapshot de `vigie status`). Toute forme JSON ajoutée ou modifiée : schéma dans `contract/`, test `conforme(Schéma, sortie)` dans le test du module, mock `ui/src/app/core/vigie.service.mock.ts` et fixtures des specs UI qui fabriquent ce type (un champ rendu requis casse leur compilation : `npm test -w ui -- --no-watch`), dans la même tâche (`models.ts` en dérive tout seul). Toute entrée (corps POST même ignoré, paramètre d'URL, message WebSocket) : schéma d'entrée avec messages en français + cas refusés en test. Les erreurs répondent `ErrorBody` (`{ error }`). Un schéma n'est pas plus permissif que la sortie réelle : pas de `optional` « pour un daemon plus ancien », l'UI est servie par son daemon (décision 035). Préfère ajouter un champ plutôt que d'en renommer un.

## Tests et lint

`node:test` + `node:assert/strict`, fichier `xxx.test.mjs` à côté du module, données dans un dossier temporaire (`fs.mkdtempSync`). Teste les fonctions pures et le store ; pas de test qui ouvre un vrai port ou un vrai PTY sans nécessité ; jamais d'import de `server.mjs`. Avant de rendre la main :
- `node --test daemon/*.test.mjs plugins/*/*.test.mjs scripts/*.test.mjs` (sandbox : préfixe `VIGIE_NO_PTY=1`)
- `npx eslint daemon plugins contract bin electron scripts` (ESLint porte les règles non négociables dans leurs formes usuelles : `zod/mini`, `server.mjs` jamais importé, contrat importé par `transport.mjs` seul, imports par liste d'autorisés, plateforme seulement dans `platform.mjs`, réseau sortant, imports des plugins ; un contournement délibéré reste à la relecture ; une nouvelle règle vérifiable = une règle ESLint)

## Doc dans la même tâche

Un comportement qui change met à jour `daemon/ARCHITECTURE.md` (modules, I/O, sécurité, « où ajouter quoi ») dans la même tâche. Ne cite jamais une décision qui n'existe pas dans `decisions/` ; si ton changement est structurant ou remplace une décision, dis-le dans ton compte rendu (décision à écrire, `README.md` / `CLAUDE.md` à mettre à jour).

## Compte rendu

Fichiers modifiés, changement de contrat éventuel (champ par champ), doc mise à jour et doc à mettre à jour par le parent, résultat des tests et du lint (sortie exacte en cas d'échec), et s'il faut redémarrer le daemon (macOS : `launchctl kickstart -k gui/$UID/dev.vigie.daemon`) pour voir le changement.
