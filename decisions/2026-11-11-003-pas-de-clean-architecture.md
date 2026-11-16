# 003 — Pas de Clean Architecture : un découpage léger, rendu explicite

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi (« lance les 3 points »)

## Contexte
Tu te demandais s'il fallait une couche Clean Architecture dans le daemon. Le daemon fait environ 1 400 lignes et n'a qu'un client (l'UI) et une source de données (les transcripts).

## Décision
Pas de ports, d'adaptateurs, de use cases ni d'injection de dépendances. À la place :
- `server.mjs` est réduit au point d'entrée ; le transport passe dans `transport.mjs`, sans logique métier ;
- le calcul de consommation devient un module pur, `usage.mjs` ;
- l'architecture est écrite dans `daemon/ARCHITECTURE.md` : modules, sens des dépendances autorisé, « où ajouter quoi ».

## Raisons
- Le découpage existait déjà en pratique (`ingest` pur, `store` pour l'état, adaptateurs). Ce qui manquait, c'était de sortir la logique du transport.
- Des couches à une seule implémentation rendraient le code plus difficile à suivre.
- Une page lisible sert mieux de référence que des dossiers `domain/` et `infrastructure/`.

## Alternatives écartées
- Clean Architecture complète : coût réel, aucun gain tant qu'il n'y a qu'un client et qu'une source.

## Conséquences
- `server.mjs` ne doit jamais être importé dans un test. On teste `createTransport` et `createStore` à la place.
- À reconsidérer si le daemon gagne un second client (MCP `report_status`, barre de menu).
