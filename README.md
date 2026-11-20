# Vigie

Outil local qui lance Claude Code dans des terminaux intégrés et montre ce que font toutes les sessions, leurs agents, et ce qu'ils consomment. Fonctionne sous **macOS et Linux** ; sous Windows, via **WSL**.

Produit : [PRODUCT.md](PRODUCT.md) · système visuel : [DESIGN.md](DESIGN.md) · décisions : [decisions/](decisions/) · daemon : [daemon/ARCHITECTURE.md](daemon/ARCHITECTURE.md).

## Prérequis

- **Node.js 24** et npm.
- **Claude Code** (`claude` dans le `PATH`).
- Linux : `build-essential` et `python3` (node-pty se compile à l'installation).

## Installation

À la racine uniquement : les workspaces (`ui`, `contract`) partagent un seul `package-lock.json`.

```bash
npm ci          # installe exactement les versions du lockfile
npm run build   # construit l'UI Angular (ui/dist), servie par le daemon
```

`npm install` ne sert qu'à ajouter ou mettre à jour une dépendance (il réécrit le lockfile).

## Lancer

```bash
npm start                     # daemon au premier plan → http://127.0.0.1:4317
npm run app                   # app Electron (réutilise le daemon s'il tourne, sinon l'embarque)
```

CLI (`bin/vigie.mjs`) :

```bash
node bin/vigie.mjs            # démarre le daemon s'il ne tourne pas, puis ouvre l'UI dans le navigateur
node bin/vigie.mjs start      # démarre le daemon en arrière-plan, sans ouvrir l'UI
node bin/vigie.mjs status     # conso et agents en attente, dans le terminal
node bin/vigie.mjs install    # service : launchd (macOS) ou systemd --user (Linux)
node bin/vigie.mjs uninstall  # retire le service
```

Variables d'environnement du daemon : `VIGIE_PORT` (port, 4317 par défaut), `VIGIE_DEV=1` (accepte en plus l'origine du serveur de dev Angular, `http://localhost:4200` : avec `npm start -w ui` ou `ng serve`, `ui/proxy.conf.json` relaie `/api`, `/ws` et `/pty` vers le daemon sur le port 4317, fixe), `CLAUDE_CONFIG_DIR` (dossier de config de Claude Code : transcripts lus sous `$CLAUDE_CONFIG_DIR/projects`, sinon `~/.claude/projects` ; `vigie install` l'écrit dans le service (plist ou unité) s'il est défini au moment de l'installation : le changer ensuite demande de relancer `vigie install`), `HTTPS_PROXY` / `NO_PROXY` (proxy du relevé du statut de Claude, décision 024).

Après une mise à jour du code, redémarre le daemon pour qu'il prenne les changements. Avec le service sous macOS :

```bash
launchctl kickstart -k gui/$UID/dev.vigie.daemon
```

## Développer

```bash
npm test                              # tout : table des plugins, daemon + plugins + scripts (node:test), puis UI (Vitest)
node --test daemon/*.test.mjs plugins/*/*.test.mjs scripts/*.test.mjs   # daemon seul
npm test -w ui -- --no-watch          # UI seule
npm run lint                          # ESLint (daemon et UI ; porte aussi les règles non négociables)
npm run build                         # build de l'UI
```

Dans un environnement qui interdit de lancer des processus (sandbox), `VIGIE_NO_PTY=1 node --test daemon/*.test.mjs plugins/*/*.test.mjs scripts/*.test.mjs` saute le seul test qui ouvre un vrai PTY.

## Paquets de l'app

```bash
npm run dist          # macOS → dist/mac-arm64/Vigie.app (non signée)
npm run dist:linux    # Linux → paquet .deb (à lancer SUR Linux : node-pty s'y compile)
```

## Linux et WSL

- Le paquet `.deb` installe l'app sous le nom `vigie-app` (la commande `vigie` reste la CLI `bin/vigie.mjs`).
- `vigie install` utilise systemd utilisateur. Pour que le daemon tourne sans session ouverte : `loginctl enable-linger`.
- **Fermer la fenêtre de l'app quitte l'app** : si le daemon y est embarqué, ses sessions s'arrêtent. Installe le service (`vigie install`) pour qu'elles survivent.
- **WSL** : Vigie et Claude Code tournent dans la distribution ; ouvre l'UI depuis un navigateur Windows sur `http://localhost:4317`, ou l'app Linux sous WSLg. Sans systemd (`[boot] systemd=true` dans `/etc/wsl.conf`), `vigie install` explique le repli (`vigie start` dans `~/.profile`). Les sessions de Claude Code lancées côté Windows ne sont pas visibles (leurs transcripts sont sous `C:\Users\…\.claude`).

## Comment ça marche

- **daemon/server.mjs** (point d'entrée) + **transport.mjs** : possède les PTY (node-pty), sert l'UI, pousse l'état par WebSocket. Écoute sur 127.0.0.1 uniquement, refuse les origines et les hôtes étrangers, sert l'UI sous une CSP qui lui interdit toute ressource extérieure (décision 044). Détail des modules : [daemon/ARCHITECTURE.md](daemon/ARCHITECTURE.md).
- **contract/** : schémas Zod du contrat daemon ↔ UI, source unique des deux côtés.
- **daemon/ingest.mjs + store.mjs + usage.mjs** : lit `$CLAUDE_CONFIG_DIR/projects/**.jsonl` (sinon `~/.claude/projects`, 14 jours) en incrémental. États : attend (autorisation/question), à toi (fin de tour, ou Échap dans Claude Code), en cours, terminé.
- **Hooks** (hooks en commande, `daemon/hook.mjs` → `~/.vigie/spool.jsonl`, décision 021 ; la route des hooks HTTP `/api/hook` reste en place mais n'est plus utilisée) et **statusline relais** (`daemon/statusline.mjs` → `~/.vigie/limits/<session>.json`, puis ta statusline habituelle) : injectés via `claude --settings` **uniquement dans les sessions lancées par Vigie**. Ta config globale n'est pas modifiée.
- **Historique de consommation** (`~/.vigie/usage.json`) : jour × session × modèle et fenêtres de 5 h closes, gardés 400 jours même quand Claude Code efface ses vieux transcripts (décision 025). Enregistré au démarrage puis toutes les 10 min ; un fichier illisible est mis de côté (`usage.json.corrupt-<date>`), jamais écrasé.
- **Réglages du daemon** (`~/.vigie/settings.json`) : locale des terminaux et seuils d'alerte (coût du jour, % de la fenêtre de 5 h), modifiables dans la page Réglages ; vaut pour les terminaux ouverts ensuite. Sans réglage ni locale dans l'environnement, les terminaux sont en `en_US.UTF-8` (macOS) ou `C.UTF-8` (Linux ; absente des glibc < 2.35 sans paquet : choisis alors une locale dans Réglages).
- **ui/** : Angular 22, un dossier par composant (décision 031), un ViewModel pour tout composant qui a de la logique ou des E/S (une sous-vue de pure présentation se branche sur le VM de son parent), xterm.js pour le terminal. Détail : [ui/README.md](ui/README.md).
- **plugins/** : plugins locaux livrés avec l'app, désactivés par défaut (décisions 034, 037, 038). Écrire un plugin : [docs/plugins.md](docs/plugins.md).

## Limites connues

- Sessions lancées hors Vigie : suivies par leur transcript seulement (pas d'état temps réel, pas de réponses rapides).
- Fenêtre de 5 h : chiffres réels de Claude Code tant qu'une session Vigie tourne, sinon estimation (100 % = plus grosse fenêtre des 14 derniers jours).
- App Electron : réutilise le daemon s'il tourne déjà (service), sinon l'embarque — il meurt alors avec l'app, PTY compris.
- Statut de Claude derrière un proxy : seul un daemon lancé depuis un shell qui déclare `HTTPS_PROXY` passe par le proxy ; lancé par launchd, systemd ou le Finder, le statut reste « inconnu ».
- Coûts : tarifs relevés à la main (`daemon/pricing.mjs`, sources non officielles) ; un changement de prix fausse les coûts jusqu'à sa correction.
- Historique : un transcript effacé pendant que le daemon est arrêté, ou après un arrêt brutal, perd la consommation qui suit le dernier enregistrement (10 min au plus).
- Spool des hooks : tourné au-delà de 20 Mo, mais seulement au démarrage ; un daemon qui tourne des semaines le laisse grossir.
- Plugins : une exception synchrone d'un plugin hors d'un appel (timer, émetteur sans écouteur `error`) arrête le daemon et ses terminaux.
- Fichier édité dans Vigie : l'écriture atomique (renommage) perd ses attributs étendus et ses ACL.
- Plugins livrés : Xcode prend le premier conteneur par ordre alphabétique, iOS seulement, en Debug-iphonesimulator ; mise ne suit ni `conf.d/*.toml` ni les `task_config.includes` hors du dossier ; `pnpm-workspace.yaml` est lu par un mini-parseur ; le cache Nx n'est jamais nettoyé ; une tâche dont le nom contient un antislash ne se lance pas.
- UI : en anglais, seule la page Réglages est traduite (le reste, messages du daemon et plugins compris, reste en français) et nombres, montants et dates gardent le format français (décision 048) ; une langue dont le catalogue n'a pas pu se charger ne se relance qu'en rechargeant la page ; raccourcis ⌘N et ⌘B sur mac seulement ; quitter une discussion reste bloqué tant que le daemon ne répond pas.
- Hors V1 : barre de menu, MCP `report_status`/`request_review`, pont vers revu.
