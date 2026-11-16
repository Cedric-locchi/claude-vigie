# 022 — Explorateur de fichiers du projet d'une session

- **Statut :** Acceptée
- **Date :** 2026-11-12
- **Décidé par :** Toi (fichiers ignorés visibles et éditables), plan validé par node-architect

## Contexte
L'onglet Diff ne permet d'ouvrir que les fichiers présents dans `git status`. Pour corriger un fichier que Claude n'a pas touché (config locale, `.env`, script), il fallait sortir de Vigie.

## Décision
Trois routes : `GET /api/sessions/:id/files` (arbre), `GET …/files/read?path=` et `POST …/files/write`, servies par `daemon/files.mjs`, qui réutilise les gardes de l'onglet Diff (`git.checkFile`, `git.replaceFile`).
- Racine : racine du dépôt, sinon le cwd résolu ; chemins relatifs à cette racine, comme `GitDiff`.
- Les fichiers ignorés par git sont listés **et éditables**, `.env` compris. Un dossier entièrement ignoré (`node_modules`, `dist`…) est listé replié (`collapsed`), sans son contenu. Hors dépôt, `node_modules` et `.git` sont repliés, les liens symboliques ni suivis ni listés.
- Appartenance d'un chemin : relatif, sans `..` sortant, sans segment `.git` ; `realpath` sous la racine.
- `~/.claude` n'est jamais écrit : `replaceFile` refuse (403) tout fichier dont le `realpath` est sous `realpath(<home>/.claude)`, pour l'explorateur comme pour l'onglet Diff (qui ne le refusait pas pour un dépôt situé là).
- Arbre plafonné à 20 000 entrées (`truncated`), sans cache : l'UI rappelle la route.

## Raisons
- Un secret local est souvent justement ce qu'on veut corriger vite ; le daemon n'écoute que sur 127.0.0.1 et les routes passent le contrôle d'hôte et d'origine (GET compris), comme le terminal qui peut déjà tout lire.
- Replier les dossiers ignorés garde l'arbre utilisable sans les cacher.
- Une seule garde d'écriture pour les deux onglets : une correction profite aux deux.

## Limites
- Pas de création, suppression ni renommage ; pas d'éditeur externe ; texte UTF-8 ≤ 100 Ko seulement.
- Le contenu d'un dossier replié n'est pas listé (un fichier qui s'y trouve reste lisible par son chemin).
- À rouvrir si l'arbre complet d'un gros dépôt devient trop lent : liste paresseuse par dossier.
