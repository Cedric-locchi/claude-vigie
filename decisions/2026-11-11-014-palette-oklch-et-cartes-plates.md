# 014 — Nouvelle palette OKLCH et cartes spartan plates

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi

## Contexte
Tu trouvais que les couleurs ne s'harmonisaient pas, que le contraste manquait, et que les cartes d'agents avaient des bordures et ombres peu nettes.

## Décision
- **Cartes :** les cartes spartan sont plates partout (filet `--line`, ni ombre ni anneau), et l'état d'un agent recolore la bordure.
- **Neutres :** teintés vers le bleu de la marque, avec des strates plus espacées.
- **Nouveau jeton `--control` :** les bordures de champs passent à 3:1 sur le fond.
- **Hiérarchie entre accents :** ils sont échelonnés par urgence. L'ambre « attend » est le plus lumineux, le vert « terminé » le plus effacé.
- **Vérification :** chaque paire de couleurs est contrôlée par script, dans les deux thèmes.

## Raisons
Mesuré avant le changement : les textes contrastaient bien (9:1). Le manque venait de la structure :
- panneau sur fond : 1,07:1 ;
- filets : 1,19:1 ;
- bordures de champs : 1,42:1, alors que WCAG demande 3:1 ;
- couleurs de données : moins de 3:1 ;
- les cinq accents avaient tous la même clarté, sans hiérarchie entre eux.

## Alternatives écartées
- Changer seulement les teintes des accents : ça ne règle pas la séparation entre les surfaces.

## Conséquences
- `DESIGN.md` et `.impeccable/design.json` sont à jour, avec deux nouvelles règles, « hiérarchie de luminance » et « séparation ».
- La palette précédente est sauvegardée dans le scratchpad de la session.
