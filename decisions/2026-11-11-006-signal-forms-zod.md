# 006 — Les vrais formulaires passent en signal forms validés par Zod

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi

## Contexte
Tu voulais fiabiliser la validation côté Angular.

## Décision
Les formulaires Nouvelle session et Message de commit utilisent les signal forms, validés par `validateStandardSchema`. Quand le formulaire produit le corps d'une requête au daemon, il réutilise le schéma du contrat. Les champs de recherche et les filtres restent de simples signaux.

## Raisons
- Le même schéma valide le formulaire et l'entrée du daemon (`CommitBody`), donc les règles ne peuvent pas diverger.
- Un champ de recherche n'a rien à valider : un formulaire n'y apporterait que du code.

## Alternatives écartées
- Signal forms sur toutes les saisies : plus homogène, mais du code sans valeur pour les champs de recherche.

## Conséquences
- Le schéma de Nouvelle session reste local à son ViewModel, car le formulaire ne correspond pas au corps de la requête.
