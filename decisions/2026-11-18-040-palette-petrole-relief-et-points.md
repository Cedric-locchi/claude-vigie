# 040 — Palette pétrole, relief léger teinté et fond pointillé

- **Statut :** Acceptée (palette remplacée par 042 ; relief et fond pointillé toujours en vigueur)
- **Date :** 2026-11-18
- **Décidé par :** Toi
- **Remplace :** 014 (palette OKLCH et cartes plates)
- **S'appuie sur :** 039 (étude, lot 1)

## Contexte
L'étude 039 proposait de reprendre la direction de la maquette « Codex » (palette claire très douce, principale pétrole, fond pointillé) et d'ajouter du relief, ce que la 014 interdisait (cartes plates, aucune ombre au repos). Pour l'ombre, tu as choisi le rendu de la maquette « Logic Editor : No-Code Workflow » : cartes blanches sans filet visible, grand halo très diffus, petite ombre de contact, teinte froide.

## Décision
**Palette** (tout passe par les jetons de `ui/src/styles.css`, règle Same-Role) :
- Clair : fond `#FCFCFC`, cartes `#FFFFFF`, barre latérale `#F0F0F0`, texte `#0C0C0C`, principale pétrole `#004854` (texte blanc dessus). Filet `#D9DDDE` au lieu du `#E4E4E4` de la maquette (1,27:1 sur blanc, sous le seuil de 1,33:1). Textes secondaires : les niveaux de Vigie (≥ 4,5:1), retintés vers le pétrole ; jamais le `#A8A8A8` de la maquette (2,3:1).
- Sombre : neutres de nuit retintés vers le pétrole (OKLCH h ≈ 210, C ≤ 0,02), même clarté qu'avant ; principale pétrole éclaircie `#5CC9CF`.
- **« En cours » = la principale pétrole** (badge, point, sparkline, barre d'état). **« Terminé »** devient un vert éteint, peu saturé (h 145, C ≈ 0,055–0,075), plus sombre que le pétrole en sombre et plus clair en clair, pour ne pas se confondre. Ambre « attend », corail, lilas, ardoise : inchangés (vérifiés).

**Relief** : deux jetons, `--elev-1` (cartes et panneaux au repos) et `--elev-2` (survol, flottants : popovers, menus, listes de choix, dialogues, notifications).
- Clair : ombre de contact courte + grand halo diffus (décalage 16–20 px, flou 40–48 px, rétreint de 12 px), teintés de la principale (6–16 %) ; **cartes sans filet** (`--edge: transparent`), le halo porte la séparation.
- Sombre : reflet haut (`inset 0 1px 0`, texte à 5–6 %) + halo pétrole très doux ; le filet reste (`--edge: var(--line)`), une ombre noire ne se voit pas sur la nuit.
- Jamais sur une ligne de tableau ni dans une liste dense (tours de la chronologie, lignes d'agents), jamais teinté par une couleur d'état. La barre d'état reste un indicateur, pas une ombre.

**Fond pointillé** sur la zone de contenu (hôte du gabarit `app-page`, toutes les pages) : points de 1 px tous les 18 px (`--dot` : texte à 10 % en clair, 7 % en sombre), fixes sous le corps qui défile. Ni sur la barre latérale ni sur la barre mobile ; cartes, panneaux, terminal et diff gardent un fond plein.

## Raisons
- La palette pétrole donne une identité plus calme que le bleu, et « en cours » en pétrole retire un accent froid de l'écran.
- Mesuré par script (WCAG 2.x) : tous les textes ≥ 4,5:1 sur fond, barre latérale, panneau et `panel-raised` dans les deux thèmes ; contrôles ≥ 3:1 ; données ≥ 3:1 sur le panneau ; filet/panneau ≥ 1,33:1 ; panneau/fond 1,15:1 en sombre.
- **Écart assumé** : en clair, panneau/fond vaut 1,03:1 (`#FFFFFF` sur `#FCFCFC`, valeurs choisies). La séparation passe par le relief, plus par le ton : la règle de séparation devient « strate ≥ 1,14:1 **ou** relief `--elev-1` ».
- Le point est à 10 % et non 12 % en clair : `--faint` posé sur le cœur d'un point garde 4,6:1 (4,4:1 à 12 %).

## Alternatives écartées
- Garder le bleu pour « en cours » : deux accents froids voisins à l'écran.
- Fond clair `#F0F0F0` sous des cartes blanches (strate à 1,14:1 sans ombre) : s'éloigne de la maquette choisie.
- Ombre noire en sombre : invisible sur la nuit, elle n'apporterait que du flou.

## Conséquences
- `DESIGN.md` : couleurs, règles nommées (Elevation remplace Flat-By-Default), Elevation & Depth, cartes, fond pointillé.
- Le thème du terminal (`terminal.vm.ts`, couleurs fixes exigées par xterm) suit les nouveaux neutres ; les couleurs ANSI ne changent pas.
- Reste en dur hors de l'UI : le fond de la fenêtre Electron au démarrage (`electron/main.mjs`, anciennes valeurs `#0d1116` / `#f1f4f7`).
- Un halo large peut être rogné par une colonne qui défile (règle de défilement du gabarit) : voulu, la colonne reste la seule zone qui défile.
