# 028 — Un graphique principal pour la page Consommation

- **Statut :** Acceptée
- **Date :** 2026-11-13
- **Décidé par :** Toi (choix entre trois maquettes), sur recommandation
- **Précise :** 017 (les graphiques retenus)

## Contexte
La première version Plot (décision 017) empilait quatre graphiques séparés : coût par jour, cumul du mois, fenêtres de 5 h passées, nuage des sessions. Le graphique par jour était jugé inutilisable (libellés d'axes qui débordaient), et la sélection d'une période au glisser avait disparu.

## Décision
Un graphique principal en tête de page remplace « coût par jour », « cumul du mois » et « fenêtres de 5 h passées » :
- barres par jour empilées par famille de modèle (jours vides compris) ;
- courbe du cumul de la période sur un axe secondaire à droite ;
- ligne du seuil d'alerte `alerts.dailyCost` (pointillé ; liseré corail sur les jours qui le dépassent) ;
- dessous, une bande des fenêtres de 5 h alignée jour par jour, qui sert aussi de sélection de période (glisser, Maj, clavier, Échap).
Le nuage des sessions, les indicateurs et les tableaux restent. Marges des axes calculées sur les graduations : aucun libellé ne déborde.

## Raisons
- Un seul endroit pour lire « combien, quand, par quel modèle, est-ce que je dépasse » ; le reste de la page se filtre depuis lui.
- Plot n'a pas de sélection au glisser : la bande maison la rétablit sans dépendance.

## Alternatives écartées
- Carte horaire jours × heures : montre quand on consomme, moins bien combien ni par quel modèle.
- Petits multiples par famille : bons pour comparer les modèles, mais éclatent le total.

## Conséquences
- La page ne demande au daemon que les jours de la période choisie (plus de mois précédent).
- Un seuil plus de deux fois supérieur au plus gros jour n'est pas tracé (il écraserait les barres) : il reste dans la légende.
