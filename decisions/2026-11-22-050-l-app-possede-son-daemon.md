# 050 — L'app possède son daemon

- **Statut :** Acceptée
- **Date :** 2026-11-22
- **Décidé par :** Toi (« le daemon devrait être une part de l'app Electron et géré par l'état de l'app » ; un daemon déjà lancé est remplacé ; CLI et service gardés) ; route d'arrêt, cas du service et des anciens daemons proposés par Claude et acceptés
- **Remplace :** le comportement « l'app réutilise le daemon s'il tourne » (jamais décidé jusqu'ici ; cité en passant par la 035, qui reste valable : l'UI est toujours servie par le daemon)

## Contexte
L'app réutilisait tout daemon déjà présent sur le port 4317 (service `vigie install`, `vigie start`, `npm start`). Elle ne savait donc pas si quitter arrêtait les sessions, et pouvait afficher l'UI d'une autre version que la sienne (UI servie par le daemon réutilisé : une app 1.6.0 montrait « v1.5.1 »).

## Décision
- L'app lance toujours son daemon (`utilityProcess`) à l'ouverture et l'arrête en quittant (inchangé : confirmation s'il reste des terminaux vivants).
- Un daemon Vigie déjà présent au lancement : dialogue (nombre de ses terminaux vivants, claude compris), puis arrêt par `POST /api/shutdown` (corps `{}`, garde d'origine des autres POST, arrêt par le chemin SIGTERM du daemon) ; l'app attend que le port se libère (5 s au plus), puis lance le sien. Refus : l'app quitte.
- Service installé (fichier launchd ou systemd présent, même service arrêté) : l'app ne démarre pas, car il redémarrerait son daemon et reprendrait le port ; elle demande `vigie uninstall` et quitte.
- Daemon sans la route (1.6.0 et avant) : message « arrête-le, puis rouvre l'app », sans recherche de PID.
- La CLI et le service restent (dev, usage dans le navigateur) ; seule l'app ne les réutilise plus.

## Raisons
- Une seule version à la fois dans l'app : son UI et son daemon viennent du même paquet.
- La route identifie un daemon Vigie : seul lui répond 200 ; on ne tue jamais un process inconnu.
- Arrêter un service launchd (`KeepAlive`) ou systemd (`Restart=always`) le relance aussitôt : course sur le port et boucle d'erreurs dans `daemon.log`.

## Alternatives écartées
- **Chercher le PID** (`lsof`, `ss`) pour les anciens daemons : un point de plateforme et un `kill` pour un cas qui n'arrive qu'une fois.
- **Désinstaller le service depuis l'app** : effets launchd / systemd dans l'app, pour un cas rare.
- **Port à part** pour le daemon de l'app : deux daemons partageraient `~/.vigie` (historique, hooks, spool).

## Conséquences
- Pour que des terminaux survivent à l'app : utiliser Vigie dans le navigateur avec le service.
- En dev, `npm start` puis `npm run app` repose la question à chaque lancement.
- Le daemon de l'app efface au démarrage les discussions du daemon remplacé (`purgeChats`) : annoncé par le dialogue (ses terminaux s'arrêtent).
- Pas de changement de contrat daemon ↔ UI.
