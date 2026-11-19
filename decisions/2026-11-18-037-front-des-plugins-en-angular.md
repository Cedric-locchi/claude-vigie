# 037 — Le plugin porte son front : composants Angular compilés avec l'app, prêts pour Native Federation

- **Statut :** Acceptée
- **Date :** 2026-11-18
- **Décidé par :** Toi
- **Remplace :** les points 1 (« l'UI ne lance jamais son code ») et 3 (vue déclarative) de la décision 034

## Contexte
Avec la 034, un plugin décrit sa vue par un arbre de nœuds JSON (`PluginNode`) que l'UI de Vigie dessine. Toute interface qui sort de cette grammaire (recherche, boutons grisés, mise en page propre) oblige à ajouter un type de nœud dans le cœur. On veut qu'un plugin porte son backend **et** son front, pour étendre Vigie sans écrire de code dans le cœur.

## Décision
- **Le front d'un plugin est un composant Angular** qui vit dans le plugin : `plugins/<id>/ui/index.ts` fait `export default` du composant de l'onglet. Il reçoit l'id de la session en entrée et injecte un service `PluginHost` (appel des méthodes de son backend, ouverture d'un terminal, rafraîchissement). Il utilise spartan, les signaux, les variables CSS et DESIGN.md comme le reste de l'UI.
- **Compilé avec l'app, chargé à la demande.** Un script lancé au build lit `plugins/*/package.json` et génère la table `id → () => import('…/plugins/<id>/ui')`. Chaque plugin devient un chunk paresseux ; le chargement initial ne grossit pas. Aucun code à écrire dans le cœur pour un nouveau plugin.
- **Prêt pour Native Federation, sans l'adopter.** Le contrat du front (export par défaut + `PluginHost` injecté) est celui qu'attend `loadRemoteModule`. Le jour où des plugins tiers doivent être chargés sans recompiler l'app, seule la table générée change.
- **Backend : des méthodes libres.** Le plugin déclare des méthodes (`methods: { tasks: { params, handler } }`) qui renvoient le JSON de son choix, par une route générique `POST /api/sessions/:id/plugins/:pid/call/:method`. Les actions qui ouvrent un terminal restent (`terminal(argv)` du SDK). Les schémas Zod propres au plugin vivent dans le plugin (`plugins/<id>/contract.mjs`), partagés par son back et son front ; le contrat de Vigie ne garde que le socle (liste, activation, détection, appel, terminal).
- **La vue déclarative est retirée** : `PluginNode` et `PluginView` du contrat, le composant `plugin-view` de l'UI.
- mise et Xcode reprennent leurs anciens composants Angular (sur `main`), déplacés dans leur plugin : la recherche de tâches mise et les boutons Xcode grisés reviennent.

## Raisons
- Un composant Angular compilé avec l'app partage Angular, spartan et les services de Vigie : aucun runtime en double, aucune version à aligner, tests Vitest comme le reste.
- Le chargement à l'exécution (Native Federation) coûte une dépendance, un build par plugin et un alignement strict des versions ; il n'apporte rien tant que les plugins sont livrés avec l'app.

## Alternatives écartées
- **Garder la vue déclarative à côté (hybride)** : deux façons d'écrire un plugin ; tu as choisi un seul modèle.
- **Native Federation dès maintenant** : coût immédiat sans plugin tiers à charger.
- **Angular Elements** : un runtime Angular par plugin (plus de 100 kB), injection de dépendances entre l'app et le plugin pénible.
- **Iframe** : isolation inutile pour des plugins livrés avec Vigie ; taille, focus, thème et accessibilité à faire traverser.

## Conséquences
- Le code d'un plugin tourne dans la page, avec le même accès au daemon que l'UI. Même confiance que son backend (034 §6) ; l'isolation reviendra avec les plugins tiers.
- Le respect de DESIGN.md devient la responsabilité de chaque plugin (mêmes composants spartan disponibles).
- Les fichiers de `plugins/*/ui/` entrent dans le build, le lint et les tests de l'UI.
