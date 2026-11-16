# Vigie

Tour de contrôle locale des sessions Claude Code. Produit : `PRODUCT.md`. Système visuel : `DESIGN.md`. Fonctionnement : `README.md`. Décisions et leurs raisons : `decisions/` (une décision structurante = un nouveau fichier `AAAA-MM-JJ-NNN-titre.md` ; on ne réécrit pas une décision, on la remplace).

## Carte du dépôt

- `daemon/` : Node 24, ESM `.mjs`, sans framework (`node:http`, `ws`, `node-pty`). Possède les PTY, ingère les transcripts, pousse l'état par WebSocket.
  - Architecture, sens des dépendances et « où ajouter quoi » : **`daemon/ARCHITECTURE.md`** (à lire avant toute modification du daemon).
  - `server.mjs` point d'entrée (câblage, effets de bord, `listen`) · `transport.mjs` HTTP, WebSocket, PTY · `store.mjs` état en mémoire (`history.mjs` fichier d'historique, `trace.mjs` trace en tours, pur) · `usage.mjs` consommation (pur) · `ingest.mjs` lecture des transcripts (pur) · `guard.mjs`, `launch.mjs` fonctions pures du transport · `platform.mjs` tout ce qui dépend de l'OS (pur, macOS/Linux/WSL) · `git.mjs`, `claude-config.mjs`, `xcode.mjs` adaptateurs · `hook.mjs`, `statusline.mjs` scripts lancés par Claude Code · `pricing.mjs` tarifs.
  - Ne jamais importer ni lancer `daemon/server.mjs` dans un test ou un script : il démarre un daemon, écrit dans `~/.vigie` et purge des discussions. Tester via `createTransport` / `createStore`.
- `contract/` : workspace `@vigie/contract`, schémas **Zod** (`zod/mini`) du contrat daemon ↔ UI. Le daemon l'importe par chemin relatif (`../contract/index.mjs`, seul `transport.mjs`) ; l'UI par son nom de paquet.
- `ui/` : Angular 22, signaux, spartan/ui (`ui/libs/ui`, alias `@spartan-ng/helm/*`), Tailwind v4, xterm.js.
- `electron/main.mjs` : app de bureau, réutilise le daemon s'il tourne déjà, sinon l'embarque.
- `bin/vigie.mjs` : CLI (`start`, `status`, `install`, `uninstall` ; service launchd ou systemd --user).

## Commandes

- Workspaces npm (`ui`, `contract`) : `npm install` **uniquement à la racine** (un seul lockfile, une seule copie de zod).
- Tout : `npm test` · daemon seul : `node --test daemon/*.test.mjs` · UI seule : `npm test -w ui -- --no-watch`
- Dans le sandbox : `VIGIE_NO_PTY=1 node --test daemon/*.test.mjs` (le sandbox interdit posix_spawnp ; saute le seul test qui ouvre un vrai PTY, qui sinon doit passer).
- Build UI : `npm run build` (dans le sandbox : `cd ui` puis `CI=1 npx ng build --progress=false`, sinon la sortie est muette).
- Paquet de l'app : `npm run dist` (dans le sandbox : `CI=1 npm run dist`).
- npm dans le sandbox : `--cache "$TMPDIR/npm-cache"` (le cache global n'est pas inscriptible).
- Dépôt git (`origin` = `git@github.com:Cedric-locchi/claude-vigie.git`, branche `main`) : `git status` / `git diff` pour voir ce qui a changé ; on ne commite et ne pousse que sur demande.

## Règles non négociables

- Local uniquement : le daemon écoute sur 127.0.0.1 ; WebSocket et POST refusent les origines étrangères ; aucune requête vers l'extérieur (polices embarquées comprises).
  - Exception unique (décision 024) : le daemon fait un `GET https://status.claude.com/api/v2/summary.json` toutes les 5 min, sans rien envoyer. L'UI ne sort jamais.
- La config Claude Code globale de l'utilisateur n'est jamais modifiée : hooks et statusline passent par `claude --settings`, seulement pour les sessions lancées par Vigie.
  - Exception unique : une discussion (session lancée par Vigie avec `cwd` = `~/.vigie/chat`) est effacée de `~/.claude/projects` (transcript + dossier des sous-agents) quand on la quitte et au démarrage du daemon. Seul un transcript dont le `cwd` est ce dossier est concerné (`store.isChat` garde la route de suppression, `store.purge` efface, `store.purgeChats` au démarrage).
- Contrat daemon ↔ UI : **`contract/index.mjs` est la source unique**. `ui/src/app/core/models.ts` n'en contient que des `z.infer` ; on ne déclare jamais un type du contrat à la main. Un champ change → schéma, sortie du daemon, son test `conforme(...)` et le mock UI dans la même tâche, toujours de façon additive. Le daemon valide ses entrées avec le contrat, l'UI valide tout ce qu'elle reçoit (`safeParse` → bandeau / message « le daemon est-il à jour ? »). Nouvelle valeur d'enum = daemon et UI ensemble (un snapshot inconnu est rejeté en entier).
- Toujours `import * as z from 'zod/mini'`, jamais `import { z } from 'zod'` (taille de l'app et du bundle UI).
- Plateformes : **macOS et Linux** (Windows via WSL). Aucun nouveau code propre à un OS hors d'un point de plateforme isolé et testé pour les deux ; chemins via `path`, jamais de `/` en dur.
- UI en français, tutoiement. Commentaires de code en français.
- Pas de nouvelle dépendance sans raison écrite ; stdlib et plateforme d'abord.
- Raccourci assumé = commentaire `ponytail:` qui nomme la limite et la suite.
