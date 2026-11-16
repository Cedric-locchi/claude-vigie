# 011 — Durcissement du daemon local

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi (« corriger le P0, le P1 et le P2 de la revue »)

## Contexte
La revue d'architecture a trouvé que n'importe quelle page web pouvait faire tomber le daemon, et lire ses routes GET par DNS rebinding.

## Décision
Le daemon :
- refuse toute requête et tout WebSocket dont l'en-tête `Host` n'est pas `127.0.0.1:<port>` ou `localhost:<port>` ;
- place les points d'entrée HTTP et WebSocket sous `try` ;
- gère les erreurs des WebSocket et ignore les messages `null` ;
- borne la taille des terminaux ;
- répond 400 à un JSON illisible et 413 à un corps de plus de 1 Mo ;
- n'accepte l'origine `localhost:4200` qu'avec `VIGIE_DEV=1`.

## Raisons
Le daemon possède tous les terminaux. S'il tombe, toutes les sessions Claude s'arrêtent avec lui.

## Alternatives écartées
Aucune.

## Conséquences
- Un proxy de dev devra réécrire l'en-tête `Host` (`changeOrigin: true`).
- Le cas d'un navigateur Windows qui ouvre l'UI d'un daemon tournant sous WSL reste accepté, puisque l'hôte est alors `localhost:4317`.
