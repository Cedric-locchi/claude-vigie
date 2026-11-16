# 008 — Cibles : macOS et Linux ; Windows via WSL

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi

## Contexte
`PRODUCT.md` supposait que tout le monde était sur Mac. Tu as d'abord demandé macOS, Linux et Windows, puis abandonné Windows natif.

## Décision
- Vigie cible macOS et Linux.
- Les utilisateurs Windows passent par WSL2 : le daemon et Claude Code tournent dans la distribution Linux, et l'UI s'ouvre depuis un navigateur Windows sur `localhost:4317` ou dans l'app Linux sous WSLg.
- Tout ce qui dépend du système est regroupé dans `daemon/platform.mjs`, un module pur testé en simulant chaque OS.

## Raisons
- Windows natif obligerait à réécrire le lancement des terminaux, la commande des hooks, la statusline et les chemins. Avec WSL, tout reste en POSIX.
- Un module pur permet de tester Linux et WSL depuis un Mac.

## Alternatives écartées
- Windows natif : abandonné, WSL le remplace.

## Conséquences
- Démarrage automatique : `vigie install` crée un service systemd utilisateur sous Linux, avec une solution de repli sous WSL quand systemd n'est pas actif. Nouvelles commandes `vigie start` et `vigie uninstall`.
- Paquet Linux `.deb` (binaire `vigie-app`), à construire sur une machine Linux. Pas d'AppImage, dont les chemins changent à chaque lancement et casseraient `hooks.json`.
- Une règle de `CLAUDE.md` interdit tout nouveau code propre à un OS en dehors de `platform.mjs`.
