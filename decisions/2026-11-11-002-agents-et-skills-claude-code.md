# 002 — Des agents et des skills Claude Code dédiés au projet

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi

## Contexte
Tu voulais des spécialistes Angular et Node, et un garant de la qualité d'architecture du backend.

## Décision
- **Trois agents** dans `.claude/agents/` : `angular-dev`, `node-dev`, et `node-architect` (en lecture seule : il planifie et relit, il n'écrit jamais).
- **Deux skills** : `/vigie-feature`, qui enchaîne cadrage, plan, implémentation, vérification et revue, et `/vigie-archi-review`.
- **Un socle commun**, `CLAUDE.md`, lu par toutes les sessions et tous les sous-agents.

## Raisons
- Les règles communes vivent dans `CLAUDE.md` plutôt que d'être recopiées dans chaque agent : un seul endroit à maintenir.
- L'architecte ne peut rien écrire : sa relecture reste indépendante de l'implémentation.
- `/vigie-feature` impose de lancer soi-même les tests plutôt que de croire le compte rendu d'un agent.

## Alternatives écartées
- Un skill par vérification (contrat, revue Angular) : remis à plus tard, à créer seulement si le besoin se confirme à l'usage.

## Conséquences
- Chaque agent liste les fichiers qu'il modifie, puisque le dépôt n'a pas d'historique git.
- Les fiches d'agents sont à tenir à jour quand les règles changent (Zod, plateformes).
