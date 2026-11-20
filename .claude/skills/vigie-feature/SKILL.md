---
name: vigie-feature
description: Livre une fonctionnalité ou une correction de Vigie de bout en bout en orchestrant les agents node-architect, angular-architect, node-dev, angular-dev et doc-auditor. À utiliser quand l'utilisateur demande d'ajouter, modifier ou corriger quelque chose dans l'app (daemon, UI ou les deux), de traiter des constats d'audit, ou tape /vigie-feature.
argument-hint: "<ce qu'il faut faire>"
---

Demande : $ARGUMENTS

## 1. Cadrer (toi, sans agent)

Lis le code concerné et classe la demande :
- **UI seule** : rien ne change dans `daemon/` ni dans la forme du JSON → `angular-dev`.
- **Daemon seul** : → `node-dev`.
- **Les deux** (nouveau champ, nouvelle route, nouvel état) : daemon d'abord, ou en parallèle si le contrat est figé avant (voir 3).

Si la demande est ambiguë sur le comportement attendu, ou si elle demande un choix qui revient à l'utilisateur (règle non négociable, décision existante à remplacer), pose la question avant de lancer quoi que ce soit. Sinon, prends le choix par défaut le plus conforme à `CLAUDE.md` et dis-le.

## 2. Plan d'architecture

Sauf pour un changement local à une seule fonction ou un seul composant : `node-architect` en mode **plan** si le daemon change, `angular-architect` en mode **plan** si l'UI change de structure (nouvelle page, nouveau service, état partagé, SDK des plugins) ; les deux en parallèle si les deux côtés changent. Donne-leur la demande et ce que tu as lu. Si un plan change le contrat daemon ↔ UI, montre-le à l'utilisateur en quelques lignes avant d'implémenter.

## 3. Implémenter

- `node-dev` avec le plan (et le contrat exact à produire), puis `angular-dev` avec le contrat livré et le comportement attendu côté utilisateur.
- **En parallèle** seulement si le contrat est figé avant (ajoute toi-même un petit schéma partagé s'il le faut) et si chaque brief donne le **partage des fichiers** : à toi / interdit (l'autre agent, `package.json`, `CLAUDE.md`, `README.md`, `DESIGN.md`, `decisions/`, `.claude/` restent au parent sauf mention). `eslint.config.mjs` et les mocks UI n'ont qu'un propriétaire.
- Chaque brief contient : l'objectif, les fichiers de départ avec `fichier:ligne` pour un constat, ce qui est hors périmètre, les commandes de vérification, et l'exigence de lister les fichiers modifiés et la doc à mettre à jour.

## 4. Décisions et doc (toi)

- Un changement structurant (sécurité, contrat, design, arborescence, nouvelle exception à une règle) = une décision `decisions/AAAA-MM-JJ-NNN-titre.md` + sa ligne dans `decisions/README.md`. Une décision citée dans le code doit exister ; grep `décision 0` dans les fichiers modifiés et vérifie chaque numéro.
- Mets à jour dans la même tâche ce que le changement rend faux : `README.md`, la carte et les règles de `CLAUDE.md`, `DESIGN.md`, `ui/README.md`, `docs/plugins.md` (les agents tiennent `daemon/ARCHITECTURE.md`).
- Une règle vérifiable mécaniquement va dans ESLint (via `node-dev`), pas seulement dans la doc.

## 5. Vérifier (toi)

Lance toi-même, sans te contenter du « tests OK » d'un agent :
- `npm test` (sandbox : `node scripts/plugin-uis.mjs --check`, puis `VIGIE_NO_PTY=1 node --test daemon/*.test.mjs plugins/*/*.test.mjs scripts/*.test.mjs`, puis `npm test -w ui -- --no-watch`)
- `npm run lint`
- le build UI (voir `CLAUDE.md`), puis : `ui/dist/ui/browser/index.html` sans script inline ni `on*=` (CSP, décision 044), chargement initial dans le budget (décision 036).

## 6. Revue d'architecture

`node-architect` en mode **revue** si le daemon a changé, `angular-architect` si l'UI a changé, en parallèle, sur la liste des fichiers modifiés. Corrige les P0/P1 via l'agent dev du côté concerné, puis relance la vérification une fois. Les P2/P3 sont rapportés, pas corrigés d'office.

## 7. Doc conforme au code (décision 047)

`doc-auditor` en mode fin de session, sur les fichiers changés (`git diff main --name-only` + non suivis). Applique toi-même ses textes de remplacement dans les `.md` ; un « écart du code » part à l'agent dev du côté concerné, ou à l'utilisateur si c'est un choix. Relance l'auditeur jusqu'à « conforme ». Fiche créée pendant la session (agent introuvable) : `general-purpose` en lecture seule, chargé de suivre `.claude/agents/doc-auditor.md`.

## 8. Version

Bump de la version selon la règle de `CLAUDE.md` (majeur / mineur / patch d'après le diff avec `main`, un seul bump par branche).

## 9. Compte rendu

Ce qui change pour l'utilisateur, version retenue et pourquoi, fichiers modifiés, décisions écrites, résultat exact des tests, du lint et du build, dérives de doc corrigées, constats d'architecture restants, choix laissés à l'utilisateur, et ce qui reste à vérifier à la main (redémarrer le daemon, regarder l'écran).
