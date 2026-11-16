# 015 — Un seul mouvement signé : l'arrivée d'une attente

- **Statut :** Acceptée
- **Date :** 2026-11-12
- **Décidé par :** Toi (« /impeccable animate »)

## Contexte
L'interface est un outil de travail : le mouvement doit servir l'état, pas décorer.

## Décision
Quand une session ou un agent se met à attendre ta réponse, l'ambre arrive plus fort puis se pose (900 ms, une seule fois), et la barre d'état du tableau se trace. Avec « réduire les animations », seule la couleur change. Tout le reste reste un simple retour d'état rapide, et les barres et sparklines s'animent en `transform`.

## Raisons
Le premier principe du produit : une session bloquée est ce qui coûte le plus cher à l'écran. C'est donc le seul moment qui mérite d'être animé.

## Alternatives écartées
- Animer les entrées de pages et de listes : de la décoration.

## Conséquences
L'arrivée rejoue aussi quand une page s'affiche avec des sessions déjà en attente. C'est voulu, et ça peut se restreindre si ça gêne.
