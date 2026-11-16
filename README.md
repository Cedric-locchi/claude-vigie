# Vigie

Outil local qui lance Claude Code dans des terminaux intégrés et montre ce que font toutes les sessions, leurs agents, et ce qu'ils consomment. Fonctionne sous **macOS et Linux** ; sous Windows, via **WSL**. Spec : « Vigie — spec simplifiée » ; maquette : « gestionnaire de sessions Claude ».

```bash
npm install && npm run build   # dépendances (workspaces ui + contract, à la racine uniquement) + UI Angular
npm start                      # daemon sur http://127.0.0.1:4317
node bin/vigie.mjs status      # conso et agents en attente, dans le terminal
node bin/vigie.mjs start       # démarre le daemon en arrière-plan, sans ouvrir l'UI
node bin/vigie.mjs install     # service : launchd (macOS) ou systemd --user (Linux)
node bin/vigie.mjs uninstall   # retire le service
npm test                       # tests daemon (node:test) + UI (Vitest)
npm run app                    # app Electron (dev)
npm run dist                   # build → dist/mac-arm64/Vigie.app (non signée)
npm run dist:linux             # build → paquet .deb (à lancer SUR Linux : node-pty s'y compile)
```

## Linux et WSL

- `npm install` compile node-pty : il faut `build-essential` et `python3`.
- Le paquet `.deb` installe l'app sous le nom `vigie-app` (la commande `vigie` reste la CLI `bin/vigie.mjs`).
- `vigie install` utilise systemd utilisateur. Pour que le daemon tourne sans session ouverte : `loginctl enable-linger`.
- **Fermer la fenêtre de l'app quitte l'app** : si le daemon y est embarqué, ses sessions s'arrêtent. Installe le service (`vigie install`) pour qu'elles survivent.
- **WSL** : Vigie et Claude Code tournent dans la distribution ; ouvre l'UI depuis un navigateur Windows sur `http://localhost:4317`, ou l'app Linux sous WSLg. Sans systemd (`[boot] systemd=true` dans `/etc/wsl.conf`), `vigie install` explique le repli (`vigie start` dans `~/.profile`). Les sessions de Claude Code lancées côté Windows ne sont pas visibles (leurs transcripts sont sous `C:\Users\…\.claude`).

## Comment ça marche

- **daemon/server.mjs** (point d'entrée) + **transport.mjs** : possède les PTY (node-pty), sert l'UI, pousse l'état par WebSocket. Écoute sur 127.0.0.1 uniquement, refuse les origines et les hôtes étrangers. Détail des modules : [daemon/ARCHITECTURE.md](daemon/ARCHITECTURE.md).
- **daemon/ingest.mjs + store.mjs + usage.mjs** : lit `~/.claude/projects/**.jsonl` (14 jours) en incrémental. États : attend (autorisation/question), à toi (fin de tour), en cours, terminé.
- **Hooks** (hooks HTTP postés au daemon → `~/.vigie/spool.jsonl` ; repli `daemon/hook.mjs` si l'organisation interdit les hooks HTTP) et **statusline relais** (`daemon/statusline.mjs` → `~/.vigie/limits.json`, puis ta statusline habituelle) : injectés via `claude --settings` **uniquement dans les sessions lancées par Vigie**. Ta config globale n'est pas modifiée.
- **Historique de consommation** (`~/.vigie/usage.json`) : jour × session × modèle et fenêtres de 5 h closes, gardés 400 jours même quand Claude Code efface ses vieux transcripts (décision 025). Enregistré au démarrage puis toutes les 10 min ; un fichier illisible est mis de côté (`usage.json.corrupt-<date>`), jamais écrasé.
- **Réglages du daemon** (`~/.vigie/settings.json`) : locale des terminaux et seuils d'alerte (coût du jour, % de la fenêtre de 5 h), modifiables dans la page Réglages ; vaut pour les terminaux ouverts ensuite. Sans réglage ni locale dans l'environnement, les terminaux sont en UTF-8.
- **ui/** : Angular 22, un ViewModel par composant, xterm.js pour le terminal.

## Limites connues

- Sessions lancées hors Vigie : suivies par leur transcript seulement (pas d'état temps réel, pas de réponses rapides).
- Fenêtre de 5 h : chiffres réels de Claude Code tant qu'une session Vigie tourne, sinon estimation (100 % = plus grosse fenêtre des 14 derniers jours).
- App Electron : réutilise le daemon s'il tourne déjà (service), sinon l'embarque — il meurt alors avec l'app, PTY compris.
- Hors V1 : barre de menu, MCP `report_status`/`request_review`, pont vers revu.
