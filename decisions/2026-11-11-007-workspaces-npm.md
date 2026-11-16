# 007 — Workspaces npm (pas pnpm, pas Nx)

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi

## Contexte
`contract/` doit être partagé entre le daemon et l'UI. La question de Nx, puis de pnpm, s'est posée.

## Décision
`"workspaces": ["ui", "contract"]`, avec un seul lockfile à la racine et une seule copie de Zod. `npm install` se lance uniquement à la racine.

## Raisons
- Nx : peu de choses à orchestrer (tests rapides, pas de CI), et l'intégration d'`electron-builder` avec `node-pty` serait coûteuse. On peut l'ajouter plus tard par-dessus les workspaces avec `nx init`.
- pnpm : avec Electron et `node-pty`, il faudrait `node-linker=hoisted`, ce qui fait perdre l'essentiel de son intérêt. npm 11 était déjà en place.

## Alternatives écartées
- Nx : à reconsidérer avec une CI, ou si l'équipe l'utilise déjà ailleurs.
- pnpm : à reconsidérer si c'est le standard de l'équipe.

## Conséquences
- Les dépendances de `ui/` passent en `devDependencies`, sinon `electron-builder` embarquerait Angular dans l'app.
- `ui/package-lock.json` est supprimé et les versions résolues à nouveau (seul `@angular/cdk` a bougé côté prod).
