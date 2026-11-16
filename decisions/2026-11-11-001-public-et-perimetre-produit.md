# 001 — Vigie est un outil d'équipe, centré sur trois usages à égalité

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi (interview `/impeccable init`)

## Contexte
Le dépôt laissait penser à un outil personnel. `PRODUCT.md` n'existait pas.

## Décision
Vigie s'adresse aux développeurs de l'équipe, qui l'installent eux-mêmes. Trois usages comptent autant : débloquer les sessions en attente, suivre le travail des agents, surveiller la consommation. Contraintes confirmées : local uniquement (127.0.0.1), config Claude globale jamais modifiée, UI en français avec tutoiement, bureau d'abord mais utilisable en largeur de téléphone.

## Raisons
- Plusieurs collègues installeront l'outil sans son auteur à côté : premier lancement, réglages par défaut et états vides doivent se suffire à eux-mêmes.
- Aucun usage ne domine, donc aucun écran n'est sacrifié au profit d'un autre.

## Alternatives écartées
- Outil personnel : écarté, l'outil est destiné à l'équipe.

## Conséquences
- `PRODUCT.md` créé, puis réécrit en français à ta demande.
- Le principe « pensé pour une équipe » guide l'onboarding et les messages d'erreur.
