# 004 — Le contrat daemon ↔ UI vit dans des schémas Zod partagés (`contract/`)

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi

## Contexte
`models.ts` était tenu à la main côté UI, alors que le daemon est en JavaScript sans types : les deux pouvaient diverger sans que personne ne le voie.

## Décision
- `contract/index.mjs` (paquet `@vigie/contract`) est la seule source de vérité.
- `models.ts` ne contient plus que des `z.infer`.
- Le daemon valide ses entrées (corps POST, messages des terminaux). Les tests `conforme(...)` vérifient que chaque sortie du daemon correspond exactement à son schéma.
- L'UI valide tout ce qu'elle reçoit avec `safeParse`. En cas d'échec, elle garde le dernier état valide et affiche le bandeau « le daemon est-il à jour ? ».

## Raisons
- Une seule description du contrat ne peut plus dériver d'une copie.
- Une forme inattendue se voit clairement à l'écran au lieu de casser l'UI.
- Mesuré : 7 µs pour valider un snapshot et 0,5 ms pour un journal de 3 Mo, donc on valide tout.

## Alternatives écartées
- Des schémas séparés de chaque côté : deux descriptions à tenir synchronisées.
- Utiliser Zod pour les types seulement, sans validation à l'exécution : un daemon trop ancien serait détecté trop tard.

## Conséquences
- Ajouter une valeur à une énumération oblige à mettre à jour le daemon et l'UI ensemble, puisqu'un snapshot inconnu est rejeté en entier.
- Un corps de requête mal formé renvoie désormais une 400 avec un message en français.
