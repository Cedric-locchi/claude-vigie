# 045 — Un architecte Angular et une revue d'architecture des deux côtés

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi (« mets à jour les skills et les agents afin de pallier les problèmes de l'audit »)
- **Complète :** la 002 (son alternative écartée « revue Angular, à créer si le besoin se confirme »)

## Contexte
L'audit d'architecture du 2026-11-19 a trouvé côté front autant de dérives que côté daemon (ressources lues sans garde, composant sans ViewModel qui recopie un chargeur, Markdown qui charge des images distantes, décision citée qui n'existait pas), alors que seul le daemon avait un relecteur (`node-architect`). Plusieurs constats venaient de règles écrites mais vérifiées par la seule relecture.

## Décision
- **Quatrième agent** `angular-architect` (`.claude/agents/`), en lecture seule comme `node-architect` : plan avant un changement structurel de l'UI, revue après.
- `/vigie-archi-review` lance les deux architectes en parallèle (back, front ou les deux) et rend une synthèse unique.
- `/vigie-feature` : plan et revue par l'architecte du côté qui change ; partage explicite des fichiers quand deux agents travaillent en parallèle ; étape « décisions et doc » (une décision citée existe, la doc rendue fausse est corrigée dans la même tâche) ; vérification par `npm test`, `npm run lint` et le build (CSP, budget).
- Les fiches `node-dev`, `node-architect`, `angular-dev` portent les règles tirées de l'audit (garde dans la fonction partagée, aucun effet de bord avant `listen`, `try` dans les timers, ressources lues par `hasValue()`, Markdown par `renderMarkdown`, pas d'`effect` pour dériver, brouillons protégés…).
- Une règle vérifiable mécaniquement va dans ESLint plutôt que dans une phrase (`CLAUDE.md`).

## Raisons
- Le besoin de la 002 est confirmé : la relecture indépendante qui tient le daemon manquait au front.
- Une règle dans ESLint ne dépend pas de la mémoire d'un relecteur.

## Alternatives écartées
- Un seul architecte pour les deux côtés : deux corpus de règles distincts (Node pur, Angular), une fiche trop longue pour rester lue.

## Conséquences
- Les fiches d'agents restent à tenir à jour quand une règle change ; un constat qui revient d'un audit à l'autre devient une règle ESLint ou une consigne d'agent.
