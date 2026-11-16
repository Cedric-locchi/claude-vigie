# 029 — Sélecteur de projet : GET /api/projects remplace /api/dirs

- **Statut :** Acceptée
- **Date :** 2026-11-13
- **Décidé par :** Toi (retrait de `GET /api/dirs` validé)

## Contexte
Le lancement d'une session proposait une liste de chemins bruts (`/api/dirs` : `string[]`). Pour choisir vite, il faut voir le type de projet, la branche courante et l'ancienneté de la dernière session.

## Décision
- Nouvelle route `GET /api/projects?q=` → `Projects` (`{ path, kind, branch, lastTs }[]`, schéma dans `contract/`). Si `q` contient un séparateur de chemin : ses sous-dossiers non cachés (50 max) ; sinon les dossiers récents du store. Chemins renvoyés en `~/…` (remplacement ancré sur le dossier personnel). Origine contrôlée même en GET : la route sonde le disque.
- `kind` vient des marqueurs à la racine du dossier (`daemon/projects.mjs`, iOS prioritaire sur `package.json`) ; `lastTs` est la dernière activité connue dans ce dossier, null pour un dossier jamais vu.
- `branch` est lue dans `.git/HEAD` (ou via `gitdir:` pour un worktree / sous-module), sans lancer `git` : la route décrit jusqu'à 50 dossiers à chaque frappe.
- `GET /api/dirs` et le schéma `Dirs` sont retirés, en exception à la règle « contrat additif » : l'UI est toujours servie par le même daemon, donc aucune UI ne peut appeler l'ancienne route une fois le daemon à jour.

## Raisons
- Un `spawn` git par dossier coûte des dizaines de process par frappe ; lire un fichier coûte une lecture.
- Garder `/api/dirs` à côté ferait vivre deux routes pour un seul écran.

## Alternatives écartées
- `git branch --show-current` par dossier : exact (remonte les parents, gère tout format de dépôt) mais trop coûteux ici.
- Ajouter des champs à `/api/dirs` : impossible sans changer sa forme (`string[]`).

## Conséquences
- Un sous-dossier d'un dépôt n'affiche pas de branche (seul le dossier lui-même est examiné) ; HEAD détachée → pas de branche.
- Une fenêtre Electron restée ouverte sur une ancienne UI pendant la mise à jour du daemon perd la liste jusqu'au rechargement.
