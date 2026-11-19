# 035 — Retrait direct des routes mise et Xcode, sans alias

- **Statut :** Acceptée (remplace le point « alias » de la 034)
- **Date :** 2026-11-18
- **Décidé par :** Toi

## Contexte
La 034 porte mise et Xcode en plugins (`plugins/mise`, `plugins/xcode`) et prévoyait de garder un temps les anciennes routes (`GET …/mise`, `GET …/xcode`, `GET …/xcode/targets`, `POST …/xcode/open`, champs `miseTask` / `miseTrust` / `xcode` / `script` de `POST …/terminals`) comme alias, « puisque le daemon peut tourner en service séparé de l'UI ».

Or l'UI est toujours servie par le daemon lui-même : Electron fait `loadURL` sur le daemon (qu'il l'embarque ou réutilise le service launchd / systemd), et le navigateur charge l'UI depuis le même port. Un daemon à jour sert donc une UI à jour.

## Décision
- Les anciennes routes et branches sont retirées d'un coup, sans alias : `daemon/mise.mjs`, `daemon/xcode.mjs`, leurs routes, leurs schémas (`MiseTask`, `MiseTasks`, `XcodeContainer`, `XcodeProject`, `Simulator`, `XcodeTargets`, `XcodeAction`, `XcodeBody`).
- `TerminalBody` devient `z.strictObject({})` : une ancienne UI qui envoie `{ miseTask }` reçoit un 400 plutôt qu'un shell vide.
- DerivedData de Vigie : `~/.vigie/plugins-data/xcode/<sha256(cwd)[0:12]>`, sans migration. L'ancien `~/.vigie/xcode` n'est plus lu ni écrit ; il reste à supprimer à la main.
- Version majeure (1.0.0) : routes et champs du contrat retirés.

## Raisons
- Aucun client réel ne parle à un daemon d'une autre version que la sienne : l'alias n'aurait servi personne, et chaque alias est du code de sécurité (lancement de process) à garder juste.
- Le seul cas exposé est un onglet de navigateur ouvert avant le redémarrage du daemon : il prend un 404 (ou un 400 sur `…/terminals`) jusqu'au rechargement, et le bandeau « le daemon est-il à jour ? » l'y invite déjà.
- Migrer DerivedData n'apporte rien : c'est un cache, Xcode le reconstruit au premier build.

## Alternatives écartées
- Alias pendant une ou deux versions : double chemin vers les mêmes outils, testé deux fois, pour un client qui n'existe pas.
- Déplacer `~/.vigie/xcode` au démarrage : écriture de plusieurs Go potentiels au lancement du daemon, pour un cache.

## Conséquences
- Un onglet ouvert avant la mise à jour doit être rechargé.
- Un premier build Xcode complet par projet après la mise à jour ; l'ancien `~/.vigie/xcode` occupe de la place tant qu'on ne l'efface pas.
- Tout futur outil passe par un plugin ; `POST …/terminals` n'ouvre plus qu'un shell.
