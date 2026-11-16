# 027 — Onglet Fichiers façon IDE léger, éditeur coloré sans dépendance

- **Statut :** Acceptée
- **Date :** 2026-11-13
- **Décidé par :** Toi (plan de design validé), Claude (technique de l'éditeur)
- **Remplace :** la limite « l'édition reste une `<textarea>` brute » de la 023 (le reste de la 023 tient)

## Contexte
L'onglet Fichiers (022, 023) montrait un seul fichier, coloré en lecture puis en texte brut dès qu'on l'éditait, sans numéros de ligne ni repère de ce que Claude a changé. Corriger un fichier y restait moins confortable que dans un éditeur, alors que c'est la raison d'être de l'onglet.

## Décision
- **Onglets** de fichiers ouverts (8 au plus : le plus ancien sans saisie se ferme), un brouillon par onglet, fermeture par ×, clic milieu ou ⌘W / Ctrl+W, confirmation si brouillon. Fil d'Ariane cliquable (déplie le dossier dans l'arbre), barre d'état (langage, lignes, Ln/Col, LF/CRLF, modifié, lecture seule).
- **Un seul éditeur** pour lire et éditer : une `<textarea>` au texte transparent (seuls curseur et sélection se voient) superposée à un `<pre>` coloré par highlight.js, mêmes métriques (police, taille, interligne, marges, tabulation, pas de retour à la ligne, ligatures coupées), dans la même cellule de grille : ils défilent ensemble sans synchronisation en JS. Recoloration au plus une fois par frame. Gouttière de numéros, ligne courante surlignée. Tab / Maj+Tab indentent de deux espaces, Échap puis Tab sort de l'éditeur, ⌘S / Ctrl+S enregistre. Au-delà de 100 000 caractères ou langage inconnu : même éditeur, sans coloration.
- **Lecture seule par défaut**, « Éditer » déverrouille : on ne modifie pas un fichier par accident pendant que Claude travaille. Les gardes de la 022 restent (Claude travaille → enregistrement bloqué, conflit sur disque → Recharger).
- **Gouttière git** : lignes ajoutées (vert), modifiées (bleu), suppression (triangle corail), calculées depuis le patch du fichier dans `GitDiff` (route git existante, relue à chaque lecture de fichier). L'arbre montre le statut git des fichiers et un point sur les dossiers qui contiennent un changement. Navigation clavier de l'arbre (motif ARIA tree, roving tabindex), ⌘P / Ctrl+P vers le filtre.
- Commentaires colorés sans italique (un glyphe synthétisé pourrait décaler le texte sous le curseur).

## Raisons
- Aucune nouvelle dépendance : la superposition réutilise highlight.js (023) et tient en un composant, quand CodeMirror 6 ajoute plusieurs centaines de kB au chunk de la page session pour des besoins (pliage, multi-curseurs) qu'on n'a pas.
- La `<textarea>` garde gratuitement ce que le navigateur sait faire : sélection, copier-coller, saisie accentuée et IME, ⌘F, correcteur coupé, accessibilité d'un champ texte natif.
- Lecture seule par défaut : une frappe égarée ne crée pas de brouillon pendant que Claude écrit le même fichier.

## Alternatives écartées
- **CodeMirror 6** : annulation par étapes, recherche intégrée, pliage, grands fichiers ; trop lourd pour l'usage actuel (corrections ponctuelles).
- **Monaco** : plusieurs Mo, workers ; hors de proportion.
- **`contenteditable` coloré** : curseur et annulation à réimplémenter, fragile.
- **Édition implicite** (taper suffit quand Claude est inactif) : plus fluide, mais une modification accidentelle devient possible dès que l'état bascule.

## Limites
- Annulation : celle de la `<textarea>` (Tab passe par `execCommand('insertText')` pour la conserver) ; pas d'historique par onglet, changer d'onglet la réinitialise.
- Coloration et numéros recalculés en entier à chaque frame de frappe : sensible vers 100 Ko sur une machine lente.
- Pas de retour à la ligne, pas de recherche intégrée (celle du navigateur), pas de pliage, pas de minimap.
- Les marqueurs git décrivent le fichier sur disque au dernier rechargement, pas le brouillon en cours.
- Quitter l'onglet Fichiers de la page session abandonne les brouillons sans confirmation (comme avant).
- ⌘W / Ctrl+W : dans un navigateur, la touche ferme l'onglet du navigateur avant que la page la voie ; dans Electron, son interaction avec le menu par défaut (Fermer la fenêtre) est à vérifier.
- À rouvrir vers CodeMirror si l'édition devient un usage courant (gros fichiers, recherche/remplacement, annulation fiable).
