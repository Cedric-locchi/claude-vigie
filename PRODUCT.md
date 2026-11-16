# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Distribuée surtout comme une app Electron qui enveloppe l'UI Angular servie par le daemon local ; accessible aussi dans un navigateur de bureau sur `http://127.0.0.1:4317`. Le langage visuel est celui du web, pas celui d'un OS natif.

Systèmes cibles : **macOS et Linux**. Pas de Windows natif : les utilisateurs Windows passent par WSL (Linux dans WSL2 ; UI via l'app Linux sous WSLg ou un navigateur Windows sur `http://localhost:4317`). Aujourd'hui seul macOS est construit et testé ; Linux est à porter (démarrage automatique, chemins, build).

## Users

Les développeurs de l'équipe, au travail, qui font tourner plusieurs sessions Claude Code en parallèle sur leur poste (macOS, Linux, ou Windows via WSL). Ils gardent Vigie ouvert à côté de leur éditeur et y reviennent souvent dans la journée : voir quelle session a besoin d'eux, suivre ce que font les sessions et les sous-agents, garder la consommation sous contrôle. Comme chaque collègue l'installe lui-même, le premier lancement, les réglages par défaut et des états vides clairs comptent.

## Product Purpose

Vigie est une tour de contrôle locale pour Claude Code : elle lance les sessions dans des terminaux intégrés et montre ce que fait chaque session, ce que font ses agents et ce qu'ils consomment. C'est réussi quand aucune session ne reste bloquée sans qu'on le voie, quand chacun comprend ce qu'a fait un agent sans lire le transcript brut, et quand le coût et la fenêtre de 5 h ne réservent jamais de surprise.

## Positioning

Vigie possède les PTY et injecte des hooks et une statusline relais dans les sessions qu'elle lance : elle voit donc l'état en temps réel (attend une autorisation, une question, fin de tour, en cours) et permet de répondre depuis l'UI. Les sessions lancées ailleurs restent suivies par leur transcript. Tout reste sur la machine du développeur.

## Operating Context

- Consultée d'un coup d'œil entre deux tâches : les états urgents doivent se lire en un seul balayage.
- Cycle de vie type d'une session : lancement (gabarit, dossier du projet, branche git ou worktree) → terminal et agents → autoriser / refuser / répondre → chronologie, diff, journal, config → terminé.
- Consommation : coût du jour estimé, tokens par session et par agent, fenêtre de 5 h (chiffres réels tant qu'une session Vigie tourne, sinon estimation).
- CLI compagnon `vigie status` ; un service peut démarrer le daemon à la connexion (launchd sur macOS aujourd'hui ; systemd utilisateur sous Linux à faire).

## Capabilities and Constraints

- États d'une session : attend (autorisation / question), à toi (fin de tour), en cours, terminé.
- Vues d’une session : Terminal & agents, Diff, Fichiers, Historique (chronologie / journal), Consommation, Config ; terminaux détachables dans une fenêtre ; « Discussion » temporaire en mode plan, sans projet.
- Local uniquement : le daemon écoute sur 127.0.0.1 et refuse les origines web étrangères ; pas de compte, pas de cloud, aucune donnée ne quitte la machine. Seule requête sortante : le statut public de Claude (status.claude.com), en lecture, sans rien envoyer (décision 024).
- Ne modifie jamais la config Claude Code globale de l'utilisateur ; hooks et statusline sont injectés via `claude --settings` uniquement dans les sessions lancées par Vigie.
- Sessions externes : suivies par le transcript seulement (pas d'état temps réel, pas de réponse rapide).
- Bureau d'abord ; les largeurs étroites (téléphone) doivent rester utilisables.
- Hors V1 : barre de menu, MCP `report_status` / `request_review`, pont vers revu.
- Non décidé : comment les collègues l'installent et la mettent à jour (aujourd'hui, `.app` macOS non signée construite en local ; paquet Linux à définir).

## Brand Commitments

- Nom : Vigie.
- Toute l'UI est en français et tutoie l'utilisateur.

## Evidence on Hand

- README.md, la spec « Vigie — spec simplifiée » et la maquette « gestionnaire de sessions Claude » (citées, absentes du dépôt).
- Aucun témoignage, chiffre d'adoption ni benchmark n'existe ; ne pas en inventer.

## Product Principles

1. Une session bloquée est ce qui coûte le plus cher à l'écran : la montrer en premier, la débloquer en une action.
2. Montrer ce que les agents ont réellement fait, à partir des vrais hooks et transcripts ; ne jamais deviner un état, et présenter une estimation comme une estimation.
3. Local et non intrusif : la machine et la config globale du développeur restent les siennes.
4. Pensé pour une équipe : compréhensible dès le premier lancement, sans que son auteur ait à l'expliquer.
