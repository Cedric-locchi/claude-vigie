# 049 — Recherche : ⌘F dans le fichier, palette de recherche dans les sessions

- **Statut :** Acceptée
- **Date :** 2026-11-20
- **Décidé par :** Toi (« ⌘F dans un fichier surligne le terme ; hors fichier, ⌘F ouvre une fenêtre façon Spotlight qui cherche dans toutes les sessions présentes dans Vigie ») ; périmètre, priorité des touches et mécanique proposés par Claude
- **Complète :** la 027 (lève sa limite « pas de recherche intégrée »)

## Contexte
La vue Fichiers cherche dans le projet (⌘⇧F) mais pas dans le fichier ouvert : l'éditeur est une `<textarea>` transparente sur un `<pre>` coloré, la recherche du navigateur n'y voit rien d'utile et Electron n'en a pas. Hors de cette vue, rien ne cherche au-delà d'une session : l'onglet Historique > Journal a son propre ⌘F, limité à la session affichée. Le journal n'existe que dans le daemon (cache par transcript), l'UI ne peut pas chercher seule dans toutes les sessions.

## Décision
- **Priorité de ⌘F / Ctrl+F.** La vue Fichiers le prend tant qu'elle est affichée (écouteur sur `document`, `preventDefault`) : fichier ouvert → barre de recherche dans l'éditeur ; aperçu Markdown → passe à la source puis ouvre la barre ; aucun fichier lu (onglet absent, en chargement ou en erreur) → vue Rechercher (comme ⌘⇧F). Partout ailleurs, la palette (écouteur sur `window`, qui passe après `document`) s'ouvre, sauf touche déjà prise, touche tapée dans un `<dialog>` ouvert, et hors mac dans un terminal xterm (Ctrl+F lui appartient ; la palette reste accessible par l'entrée « Rechercher » de la barre latérale). Le Journal perd son ⌘F ; son champ reste.
- **Barre de recherche dans le fichier** (UI seule) : texte littéral, insensible à la casse par défaut (Aa), toutes les occurrences surlignées par un calque `<pre>` de plus dans la cellule de grille de l'éditeur (texte transparent, `<mark>`), occurrence courante distincte, compteur, Entrée / Maj+Entrée, Échap pose la sélection de l'éditeur sur l'occurrence courante. 1 000 occurrences surlignées au plus.
- **Palette** : `<dialog>` modal monté dans la coque, chargé à la demande (`@defer`, hors chargement initial, décision 036). Le daemon répond à `GET /api/search?q=…&case=1` (paramètres : `SearchQuery` ; réponse : `SessionSearch`, ajouts au contrat) : sessions du snapshot (terminal claude ouvert ou activité de moins d'un jour, sous-agents compris, non masquées), cherchées dans leur titre et le titre et le texte des lignes de leur journal ; 50 sessions et 5 extraits par session au plus. Titre, projet et état viennent du snapshot côté UI. Choisir une session ouvre `/sessions/:id?log=terme` : la page retire le paramètre et ouvre Historique > Journal filtré sur le terme (une discussion, sans Historique, s'ouvre telle quelle).
- **Perf** : la recherche est servie par le cache du journal du store, porté de 50 à 200 pistes ; une recherche en parcourt 150 au plus, pour laisser au cache les journaux ouverts à côté (au-delà : session sautée, `truncated`), rend la main entre deux pistes et s'arrête quand l'UI abandonne la requête.
- **Langue** : textes en dur en français (coque et vue Fichiers pas encore traduites, décision 048).

## Raisons
- Une seule touche, au sens du contexte : chercher là où l'on est (le fichier) quand il y a un fichier, partout sinon ; c'est ce que demande l'utilisateur.
- Mesuré sur une vraie machine : le périmètre du snapshot fait ~80 transcripts / 122 Mo ; le journal se construit en ~0,45 s une fois (~37 Mo), puis une recherche coûte 3 à 10 ms. Relire les fichiers à chaque frappe coûte 0,4 à 1 s ; étendre aux 14 jours d'historique : 6,5 s au premier usage et ~250 Mo.
- Le cache du journal produit exactement les lignes de l'onglet Journal : le clic mène à ce qu'on a trouvé.
- Le calque `<pre>` se teste dans jsdom (le texte du calque doit égaler celui de l'éditeur) et défile exactement (`scrollIntoView` sur l'occurrence courante), sans plages à recalculer à chaque peinture.
- `?log=` plutôt qu'un service racine : la coque ne connaît pas la page de session, et le paramètre ne relance pas la garde de sortie.

## Alternatives écartées
- **CSS Custom Highlight API** pour le surlignage : absente de jsdom, plages à refaire à chaque peinture de la coloration.
- **Recherche sur 14 jours** ou **index alimenté par le scan** : 6,5 s et ~250 Mo.
- **Préfiltre sur les lignes brutes du transcript** à chaque frappe : 0,4 à 1 s, et rate les titres fabriqués par l'ingestion.
- **SQLite / FTS** : une base et une dépendance de plus.
- **Garder ⌘F au Journal** et la palette ailleurs : la demande vise toute la session hors fichier ; le Journal reste joignable par son champ et par la palette.

## Conséquences
- ~37 Mo de mémoire en plus après le premier ⌘F (mesuré), jusqu'à ~50–90 Mo au plafond de 200 pistes (estimé) ; plafond compté en pistes, pas en octets (`ponytail:` dans `daemon/store.mjs`).
- La palette ouvre le Journal filtré sur le terme, pas sur la ligne trouvée.
- Le Journal filtre aussi sur le nom d'agent : il peut montrer plus de lignes que le nombre annoncé par la palette.
- Il faut redémarrer le daemon après la mise à jour pour que la route existe.
- Palette chargée à la demande : si son fichier ne se charge pas (UI mise à jour pendant que l'onglet reste ouvert, daemon injoignable au premier ⌘F), une fenêtre de même style dit que la recherche est indisponible et propose « Recharger » ou « Fermer » (bloc `@error` de `app.ts`).
