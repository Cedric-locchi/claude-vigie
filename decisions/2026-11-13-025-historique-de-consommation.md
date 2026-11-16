# 025 — Historique de consommation persistant (~/.vigie/usage.json)

- **Statut :** Acceptée
- **Date :** 2026-11-13
- **Décidé par :** Toi (plan validé : historique jour × session × modèle, fenêtres de 5 h, coût d'une session au fil du temps, seuils d'alerte)

## Contexte
Vigie reconstruit tout depuis les transcripts de Claude Code et n'en relit que 14 jours. Claude Code efface lui-même ses vieux transcripts (30 jours par défaut) et une discussion est effacée quand on la quitte (décision 012) : au-delà, la consommation est perdue. On veut des périodes longues (mois, année) et l'historique des fenêtres de 5 h avec leur % réel.

## Décision
Le store tient un fichier `~/.vigie/usage.json` : `{ v: 1, rows: [...], windows: [...] }`.
- `rows` : une ligne par jour local × piste × modèle (`day, sessionId, track, title, project, model, input, output, cacheCreate, cacheRead, cost`). `track` = `<sessionId>/<nom du transcript>` : agent principal et chaque sous-agent ont leur clé.
- Idempotence : une piste chargée en mémoire **remplace** toutes ses lignes archivées, jamais d'addition. Relire, redémarrer ou enregistrer deux fois ne double rien.
- `windows` : fenêtres de 5 h closes `{ start, end, tokens, cost, pct }`, une fenêtre archivée est figée : un bloc recalculé qui la chevauche n'en remonte que `pct` (max), sinon il est ajouté ; jamais deux fenêtres qui se chevauchent ; `pct` = plus haut % réel relevé par la statusline pendant la fenêtre, `null` sans relevé.
- Écrit au démarrage (avant la purge des discussions), toutes les 10 min, et avant chaque purge ; `.tmp` + `rename`. Un fichier illisible est renommé `usage.json.corrupt-<ts>` et on repart à vide, jamais écrasé. Sans fichier, le premier scan remonte 31 jours au lieu de 14 pour amorcer l'historique.
- Une discussion y figure sous le titre `(discussion)` et le projet `discussion` : aucun texte de discussion n'est écrit sur disque.
- Titre archivé = titre de la session (Claude ou `/rename`) tronqué à 80 caractères, sinon `(sans titre)` ; jamais le début du prompt (un secret collé y vivrait 400 jours). Le prompt reste un repli d'affichage, en mémoire seulement.
- Le fichier n'est réécrit que s'il y a du neuf (scan avec changement, purge), et au moins une fois par heure. Plus de la moitié des lignes illisibles : fichier traité comme corrompu.
- `GET /api/usage?days=N` (1 à 400, défaut 14) sert lignes et fenêtres ; `GET /api/sessions/:id/cost` sert le coût d'une session au fil du temps, par agent.
- Les seuils d'alerte (coût du jour, % de fenêtre) sont stockés dans `~/.vigie/settings.json` ; l'alerte elle-même est côté UI.

## Raisons
- Pas de base de données ni de dépendance : un JSON réécrit en entier suffit au volume (environ 10 Mo par an pour un usage soutenu).
- Remplacer par piste plutôt qu'additionner rend la fusion idempotente sans journal ni curseur.
- Le store reste reconstruisible depuis les transcripts tant qu'ils existent ; le fichier ne fait que garder ce qu'ils perdent.

## Alternatives écartées
- SQLite (`node:sqlite`) : requêtes plus souples, mais un format binaire de plus à migrer pour un volume qu'un JSON tient.
- Additionner les nouveautés à chaque enregistrement : il faudrait un curseur par piste, et un redémarrage risquerait le double compte.
- Relire plus de jours de transcripts à chaque démarrage : ne survit pas à l'effacement par Claude Code.

## Conséquences (limites)
- Coût figé au tarif du moment de l'enregistrement (`pricing.mjs`) : un changement de tarif ne réécrit que les pistes encore en mémoire.
- % réel = borne basse : seules les sessions lancées par Vigie relèvent la statusline, et seul le pic vu par le daemon pendant qu'il tourne est gardé. Le rattachement d'un relevé à un bloc se fait par la date de début à 1 h près ; un bloc estimé mal aligné reste à `null`.
- Double compte possible entre transcripts forkés (un `--resume` / fork qui recopie des messages dans un nouveau fichier) : non traité, comme avant.
- Rétention 400 jours ; une session plus vieille disparaît du fichier.
- Un transcript effacé entre deux enregistrements emporte au plus 10 min de consommation.
