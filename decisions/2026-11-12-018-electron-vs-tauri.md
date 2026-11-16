# 018 — Garder Electron (pas de Tauri pour l'instant)

- **Statut :** Acceptée (confirmée le 2026-11-12)
- **Date :** 2026-11-12
- **Décidé par :** Toi

## Contexte
Tu te demandais s'il fallait remplacer Electron par Tauri.

## Décision
On garde Electron. Passer à Tauri coûte trop cher pour le moment. L'alternative la plus légère serait une PWA : `vigie start`, puis « Installer l'app » dans Chrome ou Edge.

## Raisons
- Tauri n'embarque pas Node : il faudrait livrer Node à côté de l'app, avec `node-pty` natif et l'exécution des hooks à reprendre, ou réécrire le daemon en Rust (plusieurs semaines).
- La WebView de Tauri (WebKit) n'a pas l'API web de notifications que l'UI utilise.
- Livrer Node à côté de l'app annulerait une bonne partie du gain de poids.

## Alternatives écartées
- Tauri avec Node livré à côté : quelques jours.
- Tauri avec un daemon réécrit en Rust : plusieurs semaines.

## Conséquences
À rouvrir si des problèmes de performance (poids, mémoire) apparaissent.
