# 038 — Plugins npm et Nx

- **Statut :** Acceptée
- **Date :** 2026-11-18
- **Décidé par :** Toi (demande), choix techniques sur recommandation
- **S'appuie sur :** 034, 037

## Contexte
Deux nouveaux onglets de session : « Scripts npm » (scripts du `package.json` et des workspaces) et « Nx » (projets et cibles du graphe Nx). Le plugin npm reste dans le cadre de la 034 ; le plugin Nx fait des choix qui touchent aux règles du projet (aucune requête sortante, rien écrit dans le dépôt).

## Décision
**npm**
- Lecture sans aucun process : `package.json`, `pnpm-workspace.yaml` (si pnpm), lockfiles.
- Gestionnaire : `packageManager` l'emporte toujours (corepack et pnpm refusent un autre gestionnaire) ; sinon le lockfile (pnpm, yarn, bun, npm), sinon npm. Divergence ou lockfiles multiples : avertissement affiché.
- Workspaces par `fs.promises.glob` (stdlib), motifs absolus, `..` et antislash refusés, chaque dossier sous le `realpath` du projet, plafonds (200 workspaces, 1 Mo par `package.json`).
- Lancement : `npm run --workspace=<w> <s>`, `pnpm --filter <w> run <s>`, `yarn workspace <w> run <s>`, `bun run --filter <w> <s>` ; `package.json` relu avant de lancer. Jamais `npx`, jamais d'installation par Vigie.

**Nx**
- Une seule lecture : `nx graph --file=stdout` (projets et cibles en un appel), dans la méthode lente de l'onglet, jamais dans `detect` (qui ne regarde que `nx.json`).
- Exécutable : `node_modules/.bin/nx` du dépôt, sinon `nx` du PATH ; jamais `npx` (téléchargement possible).
- Environnement de lecture : `NX_DAEMON=false` (pas de daemon Nx détaché qui survivrait à Vigie), `NX_NO_CLOUD=true`, `NX_WRAPPER_SKIP_INSTALL=true` (pas d'`npm install` par le lanceur `.nx/nxw.js`), `NX_WORKSPACE_DATA_DIRECTORY` sous `~/.vigie/plugins-data/nx/` (rien écrit dans `.nx/` du dépôt).
- **Télémétrie** : Nx envoie de la télémétrie si `nx.json` contient `"analytics": true`, sans variable pour la couper. Dans ce cas Vigie **ne lit pas le graphe** et l'explique ; lancer une cible reste possible (geste de l'utilisateur, dans son terminal).
- Lancement : `nx run <projet>:<cible>`, noms validés par regex (pas de `-` en tête, ni espace, `:`, antislash ou caractère de contrôle), sans relecture du graphe au clic (trop lent ; Nx refuse une cible inconnue).

## Raisons
- npm : tout se lit dans des fichiers ; aucun process, donc aucun risque pour une simple ouverture d'onglet.
- Nx : une seule commande au lieu d'une par projet ; les variables coupent tout ce qui sortirait de la machine ou écrirait dans le dépôt, sauf la télémétrie, d'où le refus explicite.

## Alternatives écartées
- `nx show projects` puis `nx show project <p>` : un process par projet.
- Lancer nx par `npx` : peut télécharger nx.
- Lire le graphe malgré la télémétrie active : enfreindrait la règle « aucune requête sortante ».

## Conséquences
- **Lire le graphe Nx exécute le code du dépôt** (plugins Nx, configs Vite/Jest, plugins locaux), qui peut écrire ou être lent : effet assumé, comme la lecture d'une config mise approuvée. Garde-fous : plugin désactivé par défaut, lecture seulement à l'ouverture de l'onglet, délai de 55 s, groupe de process tué.
- Dans un dépôt Nx, les deux onglets (npm et Nx) peuvent apparaître ; ils montrent des choses différentes.
- Le cache Nx de Vigie (`~/.vigie/plugins-data/nx/`) n'est jamais nettoyé automatiquement.
- Le PATH du daemon (launchd) peut ne pas contenir `nx`, `pnpm` ou `bun` alors que le terminal les trouve.
