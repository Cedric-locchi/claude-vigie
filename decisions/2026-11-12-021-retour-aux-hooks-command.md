# 021 — Retour aux hooks `node hook.mjs` (remplace 020)

- **Statut :** Acceptée (remplace 020)
- **Date :** 2026-11-12
- **Décidé par :** Toi (l'état temps réel ne remontait plus)

## Contexte
Avec la 020, Claude Code postait les hooks à `http://127.0.0.1:<port>/api/hook`. Quand le sandbox Claude Code est actif, ces requêtes passent par son proxy réseau, qui refuse 127.0.0.1 : `HTTP 403 from http://127.0.0.1:4317/api/hook`. Le daemon, appelé directement, répond bien (400 sur un corps vide) : le refus vient du proxy. La politique sandbox peut être imposée à distance, sans fichier géré local : le daemon ne peut pas la détecter.

## Décision
Les sessions lancées par Vigie utilisent à nouveau des hooks `command` (`node hook.mjs` par événement). La route `/api/hook` et `httpHooksAllowed` restent en place, inutilisées.

## Raisons
- Un hook `command` ne passe pas par le proxy : il marche avec ou sans sandbox.
- Mieux vaut un process par événement qu'un état temps réel coupé sans prévenir.

## Limites
- On retrouve le coût que la 020 supprimait (un process par événement, Electron entier dans l'app quand `node` n'est pas sur le PATH).
- À rouvrir si Claude Code sort les hooks HTTP de son proxy, ou si le sandbox devient détectable de façon fiable.
