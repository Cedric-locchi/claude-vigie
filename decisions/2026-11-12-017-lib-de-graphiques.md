# 017 — Une lib de graphiques pour comparer les modèles

- **Statut :** Acceptée (lib choisie le 2026-11-12 ; graphiques tranchés le 2026-11-13 : coût par jour par modèle, cumul du mois, fenêtres de 5 h, nuage coût × cache, coût d'une session par agent)
- **Date :** 2026-11-12
- **Décidé par :** Toi (préférence initiale pour Chart.js, Observable Plot retenu sur recommandation)

## Contexte
Le graphique de la page Consommation est fait à la main en HTML et CSS. Il ne permet pas de comparer des modèles entre eux.

## Décision
**Observable Plot**, chargé seulement sur la page Consommation.

## Raisons
- Rendu SVG : les variables CSS et les deux thèmes s'appliquent directement.
- Fait pour comparer (petits multiples, groupes, nuages de points).
- Environ 80 à 100 kB gzippés, chargés à la demande.

## Alternatives écartées
- Chart.js (ta préférence de départ) : solide et léger, mais en canvas. Il faudrait recopier les couleurs en JS et redessiner à chaque changement de thème, et chaque comparaison (petits multiples, groupes) demande une configuration verbeuse.
- ECharts : à partir de 300 kB, utile seulement pour le zoom ou la sélection à la souris.

## Conséquences
**Reste à trancher :** quelles comparaisons garder parmi les cinq proposées (coût par jour par modèle, coût moyen par session, taux de cache, nuage de points des sessions, rapport sortie / entrée), et s'il faut remplacer le graphique actuel ou en ajouter un.
