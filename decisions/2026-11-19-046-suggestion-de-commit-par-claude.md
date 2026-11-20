# 046 — Suggestion de message de commit par `claude -p` : deuxième exception au « local uniquement »

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi (« on l'ajoute dans les exceptions »)
- **Complète :** la 024 (première exception : statut de Claude)

## Contexte
L'onglet Diff propose un message de commit. Sur ton clic, le daemon lance `claude -p` (`daemon/git.mjs`, `suggestCommitMessage`) avec un prompt qui contient le diff du dépôt (tronqué), la liste des fichiers non suivis et les 15 derniers titres de commit. Claude Code envoie ce prompt à l'API d'Anthropic. L'audit d'architecture du 2026-11-19 a relevé qu'aucune décision ne couvrait cette sortie face à la règle « aucune requête vers l'extérieur ».

## Décision
La suggestion de message de commit est une **exception acceptée** au « local uniquement », aux conditions suivantes, qui la bornent :
- **Seulement sur un geste explicite** (bouton de l'onglet Diff) ; jamais automatique, jamais en tâche de fond.
- **Par le binaire `claude` de l'utilisateur**, avec son compte : le daemon ne fait lui-même aucune requête réseau.
- **Hors du dépôt, sans rien du projet ni de tes réglages** : lancé depuis `~/.vigie/commit-message` (dossier vide), prompt sur stdin :
  `claude -p --no-session-persistence --tools '' --strict-mcp-config --setting-sources '' --model haiku`.
  Ni CLAUDE.md, réglages, hooks ou `.mcp.json` du dépôt ; ni `settings.json`, hooks ou plugins de l'utilisateur ; aucun serveur MCP. Reste ce que la CLI impose : réglages et hooks gérés de l'organisation (et leur CLAUDE.md géré), identifiants (OAuth, trousseau), variables `ANTHROPIC_*`. `--bare` est écarté : il coupe l'authentification OAuth des abonnés.
- **Borné dans le temps** : délai de 2 min, annulé si la requête est abandonnée, groupe de process tué au délai et à l'arrêt du daemon.
- **Contenu limité** à ce qui sert le message, lu par `git` dans le dépôt puis passé dans le prompt : diff (tronqué à `MAX_PROMPT_DIFF`), noms des fichiers non suivis (pas leur contenu), titres des derniers commits.
- L'UI ne sort toujours jamais : elle appelle seulement la route locale `POST …/git/commit-message`.

## Raisons
- Le code part déjà chez Anthropic dès que tu travailles dans la session Claude Code de ce dépôt ; la suggestion n'expose rien de plus à un autre destinataire.
- C'est une aide que tu déclenches, pas une télémétrie : rien ne sort sans ton clic.

## Alternatives écartées
- Retirer la fonction : perte d'un usage voulu, pour un risque que le geste explicite borne déjà.
- Générer le message localement (heuristique sur le diff) : qualité très inférieure.

## Conséquences
- `CLAUDE.md` liste deux exceptions au « local uniquement » (024, 046). Toute autre sortie, même sur un geste, demande sa propre décision.
- Élargir le contenu envoyé (fichiers entiers, transcripts) ou déclencher sans clic = nouvelle décision.
- `daemon/ARCHITECTURE.md` (sorties réseau) cite cette exception.
