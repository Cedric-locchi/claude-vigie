---
name: vigie-feature
description: Livre une fonctionnalité ou une correction de Vigie de bout en bout en orchestrant les agents node-architect, node-dev et angular-dev. À utiliser quand l'utilisateur demande d'ajouter, modifier ou corriger quelque chose dans l'app (daemon, UI ou les deux), ou tape /vigie-feature.
argument-hint: "<ce qu'il faut faire>"
---

Demande : $ARGUMENTS

## 1. Cadrer (toi, sans agent)

Lis le code concerné et classe la demande :
- **UI seule** : rien ne change dans `daemon/` ni dans la forme du JSON → étape 3 directement avec `angular-dev`.
- **Daemon seul** : → étapes 2 et 3 avec `node-dev`.
- **Les deux** (nouveau champ, nouvelle route, nouvel état) : toutes les étapes, daemon d'abord.

Si la demande est ambiguë sur le comportement attendu, pose la question avant de lancer quoi que ce soit.

## 2. Plan d'architecture (si le daemon change)

Lance `node-architect` en mode **plan**, sauf pour un changement local à une seule fonction. Donne-lui la demande et ce que tu as lu. Si son plan change le contrat daemon ↔ UI, montre-le à l'utilisateur en quelques lignes avant d'implémenter.

## 3. Implémenter

- `node-dev` avec le plan (et le contrat exact à produire).
- Puis `angular-dev` avec le contrat livré par `node-dev` (champs, routes) et le comportement attendu côté utilisateur.
- Les deux en parallèle seulement si le contrat est déjà figé et qu'ils ne touchent pas les mêmes fichiers.

Chaque brief contient : l'objectif, les fichiers de départ, ce qui est hors périmètre, et l'exigence de lister les fichiers modifiés.

## 4. Vérifier (toi)

Lance toi-même `npm test` puis le build UI (voir `CLAUDE.md`). Ne te contente pas du « tests OK » d'un agent.

## 5. Revue d'architecture (si le daemon a changé)

Lance `node-architect` en mode **revue** sur la liste des fichiers modifiés. Corrige les P0/P1 via `node-dev`, puis relance la vérification une fois. Les P2/P3 sont rapportés, pas corrigés d'office.

## 6. Version

Bump de la version selon la règle de `CLAUDE.md` (majeur / mineur / patch d'après le diff avec `main`, un seul bump par branche).

## 7. Compte rendu

Ce qui change pour l'utilisateur, version retenue et pourquoi, fichiers modifiés, résultat exact des tests et du build, constats d'architecture restants, et ce qui reste à vérifier à la main (redémarrer le daemon, regarder l'écran).
