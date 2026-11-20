# 043 — Panneaux détachés sur le fond pointillé et icônes de types de fichiers

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi (livrée avec la 1.0.0, écrite après coup : le code la citait déjà, le fichier manquait, relevé par l'audit d'architecture du 2026-11-19)
- **Complète :** la 040 (fond pointillé, relief) et la 042 (trois couleurs)

## Contexte
La 040 réservait le fond pointillé à la zone de contenu : barre latérale `nav-night` pleine, vues en colonnes collées. L'onglet Fichiers (décision 027) affichait des icônes monochromes, peu lisibles dans un arbre dense.

## Décision
**Panneaux détachés.**
- La barre latérale devient un panneau détaché (variante `floating` de spartan) : marge autour, rayon 12px, `--elev-1`, fond `--surface` (`--sidebar`), posée comme la zone principale sur le fond pointillé (`--dots`). En mobile, le panneau coulissant de spartan est inchangé.
- Les vues en colonnes d'une session sont des panneaux séparés sur le fond pointillé, chacun défile seul : Config (navigation, contenu), Diff (fichiers, patch), Fichiers (rail d'activité en pilule verticale, arbre, éditeur).
- Éditeur de Fichiers : la ligne du curseur est une bande lavée de la principale (`--brand` à 8 %).

**Icônes de types de fichiers** (`ui/src/app/core/file-icon.ts`).
- Une forme (glyphe 16 × 16, tracé maison) et une couleur (jeton de `styles.css`), déduites du seul nom (jamais du contenu).
- Fichiers : couleur de leur écosystème (`--ft-*` : TypeScript bleu, JS jaune, Rust…), **exception assumée à la règle des trois couleurs**, limitée aux icônes de fichiers. Chaque couleur tient 3:1 sur `--surface` et `--nav` dans les deux thèmes (variantes claires de même teinte pour celles qui ne tiennent pas sur blanc).
- Dossiers : palette Vigie (`--fd-*` : principale, secondaire, orange, vert, neutres).

## Raisons
- La barre latérale pleine coupait le fond pointillé en deux ; en panneau, la coque se lit comme le reste de l'app (des panneaux posés sur un fond).
- Des panneaux séparés rendent visible que chaque colonne défile seule (règle de défilement du gabarit).
- Un arbre de fichiers se balaie par la couleur de l'écosystème : c'est la convention des IDE. Restreinte aux icônes, l'exception ne porte aucun état et ne concurrence pas les rôles de la 042.

## Alternatives écartées
- Icônes de fichiers en neutre ou dans les trois couleurs : un `.ts` et un `.json` deviennent indiscernables.
- Une police ou un thème d'icônes tiers : dépendance et ressource en plus pour quelques glyphes (polices embarquées, décision 013).

## Conséquences
- `DESIGN.md` : navigation (barre latérale en panneau détaché), fond pointillé (sous la barre latérale aussi), règle Three-Colors (exception des icônes de fichiers), Don't des teintes.
- Toute nouvelle couleur `--ft-*` passe le seuil de 3:1 sur `--surface` et `--nav` dans les deux thèmes avant d'être ajoutée.
