---
name: Vigie
description: Tour de contrôle locale des sessions Claude Code — terminaux, agents, consommation.
colors:
  night: "#0b1214"
  abyss: "#050b0d"
  nav-night: "#0d1618"
  panel: "#162123"
  panel-raised: "#1e2b2e"
  hairline: "#2b383a"
  hairline-strong: "#3c4b4d"
  control: "#69777a"
  ink: "#e6eced"
  ink-soft: "#cad3d4"
  ink-muted: "#a8b3b6"
  ink-faint: "#8e9b9d"
  violet: "#9b9eff"
  violet-hover: "#b7bcff"
  violet-wash: "#212147"
  teal: "#69c8d6"
  teal-wash: "#022c32"
  orange-wait: "#ffb864"
  orange-wait-hover: "#ffce93"
  orange-wash: "#321c04"
  orange-line: "#6a4316"
  green-done: "#8aa88a"
  green-wash: "#1c261c"
  red-err: "#fc7a79"
  red-wash: "#361919"
  red-line: "#6c3434"
  grey-read: "#8a9496"
  on-violet: "#0f0f23"
  on-orange: "#221202"
  light-paper: "#fcfcfc"
  light-card: "#ffffff"
  light-nav: "#f0f0f0"
  light-panel-raised: "#ecf1f2"
  light-hairline: "#d9ddde"
  light-ink: "#0c0c0c"
  light-ink-faint: "#5b6769"
  light-violet: "#635bdb"
  light-violet-wash: "#f1f2ff"
  light-teal: "#087f8c"
  light-teal-run: "#006570"
  light-teal-wash: "#d8f5f9"
  light-orange-fill: "#e69a45"
  light-orange-wait: "#a25b00"
  light-green-done: "#4a714b"
  light-red-err: "#a51e23"
  light-grey-read: "#616b6d"
typography:
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  body-small:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.05em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.2
  code:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: "0px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.on-violet}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.violet-hover}"
  button-wait:
    backgroundColor: "{colors.orange-wait}"
    textColor: "{colors.on-orange}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  button-wait-hover:
    backgroundColor: "{colors.orange-wait-hover}"
  button-outline:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    rounded: "{rounded.md}"
    size: "32px"
  badge-waiting:
    backgroundColor: "{colors.orange-wash}"
    textColor: "{colors.orange-wait}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-running:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-done:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green-done}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-issue:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.red-err}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "14px 18px"
  input:
    backgroundColor: "{colors.night}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 12px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.none}"
  kpi-badge:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal}"
    rounded: "{rounded.pill}"
    size: "44px"
  nav-item-active:
    backgroundColor: "{colors.violet-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
---

# Design System: Vigie

## Overview

**Creative North Star: "La Tour de contrôle"**

Vigie est une salle de contrôle de nuit. Le fond est sombre et calme, presque silencieux ; l'information est dense mais rangée en lignes et en colonnes alignées, lisibles d'un balayage. La couleur n'est pas décorative : elle signale. Trois couleurs et deux accents (décision 042) : le violet est l'identité et l'action, le bleu-vert porte les données et le travail en cours, l'orange attire l'attention sur ce qui attend ; le vert dit « terminé », le rouge « erreur ». Si rien n'attend, l'écran est presque monochrome, et c'est voulu.

L'interface s'efface derrière ce qu'elle surveille : terminaux, chronologies, chiffres de consommation. Les contrôles sont précis et retenus ; les actions principales prennent l'aplat violet, et seule l'action qui débloque une session (Autoriser, Répondre) prend l'aplat orange. La profondeur vient de strates de ton, de filets de 1px et d'un relief léger (neutre en clair, teinté de violet en sombre) : un grand halo très doux sous les cartes et les panneaux, plus marqué pour ce qui flotte. La zone de contenu est posée sur un fond pointillé discret. Le thème sombre est le thème par défaut ; un thème clair (inspiré de Codex : fond quasi blanc, cartes blanches sans filet, barre latérale grise) reprend les mêmes rôles, valeur pour valeur.

**Key Characteristics:**
- Sombre par défaut, thème clair complet avec les mêmes rôles de couleur.
- Couleur = rôle. Violet agit (actions, focus, sélection), bleu-vert mesure et tourne (données, « en cours »), orange attend, vert terminé, rouge erreur. Les commandes restent neutres.
- Dense et aligné : tableaux, colonnes de chiffres en mono, lignes de 12px de haut de padding.
- Relief léger : `--elev-1` sous les cartes et panneaux au repos, `--elev-2` pour ce qui flotte ou est survolé ; jamais sur les lignes ni les listes denses.
- Fond pointillé sous la zone de contenu, fond plein dans tout ce qui contient.
- Micro-interactions courtes et identiques partout (120 ms / 200 ms, même courbe).

## Colors

Trois couleurs et deux accents (décision 042, qui remplace la palette de la 040), sur des neutres retintés vers le bleu-vert (h ≈ 210, C ≤ 0,02). En clair : papier quasi blanc `#FCFCFC`, cartes `#FFFFFF`, barre latérale `#F0F0F0`, texte `#0C0C0C`. Chaque couleur a sa variante de nuit : même teinte OKLCH, clarté relevée.

### Primary
- **Violet** (`violet`, `--brand` ; clair `#635BDB`, sombre `#9B9EFF`) : identité et action. Bouton principal (aplat, texte blanc en clair, nuit en sombre), lien, anneau de focus, élément de navigation actif, sélection, éditions (chronologie, fichiers modifiés). Sa version lavée (`violet-wash`, `--brand-bg`) sert de fond à l'élément sélectionné.

### Secondary
- **Teal** (`teal`, `--data` ; clair `#087F8C`, sombre `#69C8D6`) : données. Heatmap, tirets des indicateurs, jauges et barres de progression (fenêtre 5 h, contexte), sparklines, graphiques de Consommation (avec le violet quand il y a deux séries), agents dans les chronologies. Lavé : `--data-bg`.
- **« En cours »** (`--run`) : le même bleu-vert pour l'état (badge, point, barre d'état). En clair, `#087F8C` tombe à 4,2:1 sur `panel-raised` : `--run` est sa variante texte plus sombre `#006570` ; en sombre, `--run` = `--data`.

### Tertiary
- **Orange Wait** (`orange-wait`, `--wait` / `--wait-fill`) : tout ce qui attend l'utilisateur — autorisation, question (plein), fin de tour (contour seul : « à toi » ne bloque rien). Aplat (`--wait-fill`, clair `#E69A45`, texte sombre `--on-wait` : le blanc n'y tient pas 4,5:1) pour le bouton Autoriser et le compteur de la cloche ; texte, points, barres et tirets en `--wait` (clair `#A25B00`, variante sombre de la même teinte : `#E69A45` ne fait que 2,3:1 sur blanc). Fond lavé `orange-wash`, filet `orange-line`. C'est le signal le plus rare de l'app.

### Accents
- **Green Done** (`green-done`, `--ok`) : session ou agent terminé, positif, ajout dans un diff. Vert éteint, peu saturé (h 145).
- **Red Err** (`red-err`, `--err`) : erreur, suppression, daemon injoignable, au-delà d'un seuil.
- **Grey Read** (`grey-read`, `--read`) : lectures et activité passée (sparklines des sessions finies) ; gris neutre, distinct de `--neutral` (barres « autre ») par la clarté.
- Les commandes shell (chronologies, lanceur de tâches, journal) n'ont pas de couleur : neutre mono (`--text-2`) ; une ligne du lanceur survolée prend le violet.

### Neutral
- **Night** (`night`) : fond de page (clair : `light-paper`, sous le fond pointillé). **Abyss** (`abyss`) : fond le plus profond, terminaux et blocs de code. **Nav Night** (`nav-night`) : barre latérale et popovers (clair : `light-nav` `#F0F0F0`).
- **Panel** / **Panel Raised** (`panel`, `panel-raised`) : surfaces de contenu, puis contrôles et zones survolées posés dessus.
- **Hairline** / **Hairline Strong** (`hairline`, `hairline-strong`) : filets de séparation (cartes, lignes, panneaux), puis bordures appuyées (survol, terminal). **Control** (`control`, `--control` / `--input`) : bordure des champs et contrôles, à 3:1 du fond (WCAG 1.4.11).
- **Ink** → **Ink Faint** : quatre niveaux de texte, du titre (`ink`) aux métadonnées (`ink-faint`). `ink-faint` reste au-dessus de 4,5:1 sur toutes les surfaces, dans les deux thèmes.

### Named Rules
**The Luminance-Hierarchy Rule.** Les états ne sont pas égaux : leur clarté (OKLCH) suit l'urgence, et deux états de teinte voisine se séparent aussi en clarté. Thème sombre : orange « attend » L 0,83 (le plus lumineux de l'écran), bleu-vert « en cours » L 0,78, rouge L 0,73, vert « terminé » L 0,70 et C 0,055 pour s'effacer ; violet L 0,74 (action, pas état). Thème clair (texte ≥ 4,5:1 sur toutes les surfaces) : orange L 0,54 (et son aplat L 0,75), vert « terminé » L 0,51, rouge L 0,47, bleu-vert « en cours » L 0,46 ; violet L 0,55.

**The Separation Rule.** Panneau/fond ≥ 1,14:1 **ou** relief `--elev-1` (en clair, carte blanche sur `#FCFCFC` = 1,03:1 : le halo porte la séparation), filet/panneau ≥ 1,33:1, contrôle/fond ≥ 3:1, couleurs de données (barres, sparklines) ≥ 3:1 sur le panneau. Neutres teintés vers la secondaire (teinte OKLCH ≈ 210, chroma ≤ 0,02). Pastille d'indicateur : icône ≥ 3:1 sur son fond lavé. Tout nouveau jeton passe ces seuils dans les deux thèmes avant d'être ajouté.

**The Lights-Out Rule.** Au repos, l'écran est neutre. Une couleur d'état n'apparaît que si l'état existe ; un écran sans session en attente ne contient pas d'orange (pastille Sessions comprise).

**The Three-Colors Rule.** Bouton principal = violet, toujours. Bouton secondaire = neutre (outline, ghost) ou bleu-vert. Graphiques = bleu-vert, violet en seconde série, puis des neutres. Orange = attirer ponctuellement l'attention (attente), rien d'autre. Vert = positif, rouge = erreur. Cartes majoritairement blanches en clair. Aucune autre teinte (le lilas des commandes a disparu).

**The Same-Role Rule.** Chaque couleur a un jumeau dans le thème clair (`:root[data-theme='light']`). On n'écrit jamais de hex dans un composant : on passe par la variable CSS, et les composants spartan passent par les jetons sémantiques dérivés (`--primary`, `--muted`, `--border`…).

## Typography

**Body Font:** Inter (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo)

**Character:** Inter, neutre et compact, porte toute l'interface ; JetBrains Mono porte uniquement ce qui se mesure ou se tape — chiffres, coûts, durées, branches, chemins, commandes.

### Hierarchy
- **Headline** (600, 24px, -0.01em) : titre de page (Dashboard, Consommation). Un seul par écran ; 20px dans les panneaux en surimpression (Nouvelle session).
- **Title** (600, 13–16px) : titre de session, nom d'agent, en-tête de carte.
- **Body** (400, 14px, 1.4) : texte courant. Le Markdown des rapports d'agents passe à 13px / 1.6.
- **Body small** (400, 12px) : sous-lignes, aides sous les champs, états.
- **Label** (600, 11px, 0.05em, majuscules) : en-têtes de colonnes uniquement. Les libellés des cartes d'indicateurs restent en casse normale (600, 13px, avec icône).
- **Data** (JetBrains Mono 500, 24px) : valeurs d'indicateurs ; 11–12px dans les cellules de tableau.

### Named Rules
**The Measured-Mono Rule.** Le mono est réservé à ce qui se mesure ou se copie (montants, durées, tokens, branches, chemins, commandes). Jamais pour faire « technique ».

**The 11px Floor Rule.** 11px est le plus petit texte courant. 9–10px n'existe que pour les graduations de la chronologie et les valeurs au-dessus des barres du graphique.

## Layout

Une barre latérale repliable (18rem, ou icônes seules via ⌘B) et une zone de contenu. Sous 768px, la barre latérale devient un panneau ouvert par un bouton dans une barre mobile.

Les pages suivent un même gabarit : padding 28px / 36px / 40px (20px / 16px sous 720px), sections espacées de 24px, en-tête titre + outils à droite. Le contenu est rangé en tableaux à colonnes fixes plutôt qu'en grilles de cartes : la liste des sessions est une grille CSS de 8 colonnes qui en perd deux sous 1200px et passe sur deux lignes par session sous 820px.

### Gabarit de page et défilement
Toute page routée (et la page de session) est posée dans le gabarit `app-page` (`ui/src/app/shell/page/`), qui porte la règle de défilement une fois pour toutes. Trois zones : l'en-tête (`[pageHeader]`, titre et outils, barre d'attente…), la barre d'onglets facultative (`[pageTabs]`), le corps (tout le reste). Espacements réglables par variables : `--page-pt`, `--page-px`, `--page-pb`, `--page-gap`, `--page-max` (largeur, padding compris).

- **Bureau (> 720px)** : la coque (`main`, app.ts) fait exactement la hauteur de la fenêtre, sous la barre mobile et les bandeaux ; le document ne défile jamais (`overflow: clip`). En-tête et onglets restent fixes. Un seul défilement :
  - `mode="scroll"` (défaut) : le corps défile. Dashboard, Consommation, Réglages, Plugins, Nouvelle session ; dans une session : Consommation, onglets de plugins, agents d'une session lancée hors de Vigie.
  - `mode="fill"` : le corps ne défile pas, il donne toute la hauteur restante à la vue, dont **chaque colonne défile seule** : terminal et agents (empilés sous 1100px, 3/5 – 2/5), Diff (fichiers + patch), Fichiers (arbre + éditeur), Historique (Gantt borné à 30 % de la vue, au plus 232px ; les tours prennent le reste ; le Journal est une seule colonne), Config (navigation + contenu).
  - Jamais un corps qui défile contenant une colonne qui défile, ni une liste à hauteur bornée dans une page qui défile (la liste des dossiers de Nouvelle session s'allonge).
- **Téléphone (≤ 720px)** : seul le document défile, quel que soit le mode. La barre mobile (52px) et la barre d'onglets (41px) collent en haut ; `--sticky-top` (posé par le gabarit : 52px, 93px avec onglets) place ce qui colle dessous (barre du lanceur des plugins) et le `scroll-margin-top` des ancres (tours de l'historique). Les colonnes s'empilent, sans défilement vertical interne. Exceptions voulues : le terminal et l'éditeur de Fichiers (hauteur propre, `100dvh - --chrome-top`), le Gantt (hauteur bornée), les blocs de code, le patch du Diff et la barre d'onglets (défilement horizontal).
- **Fond pointillé** : l'hôte du gabarit porte des points de 1px tous les 18px (`--dot` : texte à 10 % en clair, 7 % en sombre), fixes sous le corps qui défile. Rien d'autre n'a de points : barre latérale, barre mobile, cartes, panneaux, terminal et diff gardent un fond plein. Le texte posé sur le fond (titres) garde 4,5:1 même sur le cœur d'un point (`--faint` 4,6:1 en clair).
- Une colonne qui défile contient ses éléments `sr-only` (`position: relative`), sinon ils agrandissent la zone au-dessus.

Le rythme interne suit une échelle serrée : 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16px pour les gaps, 12px × 18px de padding pour les lignes de tableau et les indicateurs.

## Elevation & Depth

La profondeur vient de strates de fond — `abyss` < `night` < `panel` < `panel-raised` —, de filets de 1px et d'un relief léger (décision 040 ; teinte : décision 042). Le survol et la pression mélangent la surface vers la couleur du texte (`--hover` à 4 %, `--press` à 9 %, en `color-mix` oklch), ce qui fonctionne à l'identique dans les deux thèmes.

### Shadow Vocabulary
- **Repos** (`--elev-1`) : cartes spartan (`hlmCard`), panneaux des vues (tableau des sessions, indicateurs, activité, terminal, carte des agents, Diff, Config, Journal, Gantt, cartes de plugins, thèmes du lanceur de tâches).
  - Clair : trois couches resserrées **neutres** (couleur du texte) : contact (`0 1px 2px`, 11 %), proche (`0 4px 10px -2px`, 13 %), portée (`0 10px 20px -8px`, 17 %), même densité qu'avec le pétrole de la 040. Un halo violet teinterait les cartes blanches. Ombre nette, peu diffuse. Cartes **sans filet** (`--edge: transparent`) : l'ombre porte la séparation.
  - Sombre : reflet haut (`inset 0 1px 0`, texte 6 %) + anneau principal (`0 0 0 1px`, 8 %) + ombre noire courte (`0 4px 12px -2px`, 50 %) + portée violette (`0 10px 24px -8px`, 24 %). Le filet reste (`--edge: var(--line)`).
- **Flottant / survolé** (`--elev-2`) : même famille, plus marquée. Popovers, menus, listes de choix, dialogues (avec un filet `--line` en anneau), notifications, recherche rapide de Fichiers, carte de plugin survolée. En sombre, anneau violet à 14 % et ombre noire plus marquée.
- **State bar** (`box-shadow: inset 2px 0 0 var(--brand)` ; 3px dans les tableaux) : la barre d'état à gauche d'un élément actif (violet), en cours (bleu-vert, `--run`) ou urgent (orange / rouge). Ce n'est pas une ombre de relief, c'est un indicateur.
- **Halo d'état** (`box-shadow: 0 0 0 3px var(--wait-bg)`) : anneau autour d'un point d'état, pour le détacher.

### Named Rules
**The Quiet-Relief Rule.** Une carte ou un panneau porte `--elev-1`, ce qui flotte ou se survole `--elev-2` ; rien d'autre ne porte d'ombre. Jamais sur une ligne de tableau ni dans une liste dense (lignes de sessions, d'agents, tours de la chronologie, entrées du journal), jamais teinté par une couleur d'état, jamais d'ombre écrite à la main dans un composant : on passe par le jeton.

## Shapes

Des angles doux et sobres, croissant avec la taille du conteneur : 12px pour les grands panneaux (tableau des sessions, indicateurs, terminal, diff), 10px pour les tours de la chronologie, 8px pour les boutons, champs et popovers, 6px pour les éléments de liste, 4px pour les petits marqueurs. Les badges d'état sont des pilules. Exception volontaire : les lignes de navigation de la barre latérale sont à angle droit, pour que la barre d'état de gauche reste droite.

## Components

### Buttons
Précis et retenus.
- **Shape :** coins doux (8px), hauteur 36px (32px en `sm`, 40px en `lg`).
- **Primary :** aplat violet, texte blanc (clair) ou nuit (sombre). Toujours le violet. Une seule par écran (Nouvelle session, Lancer la session).
- **Wait :** aplat orange (`--wait-fill`), texte sombre gras — réservé aux actions qui débloquent une session (Autoriser, Répondre, Reprendre une session urgente).
- **Outline / Ghost :** actions secondaires et icônes, neutres. Le ghost de suppression vire au rouge au survol.
- **Hover / Focus :** transition 120 ms ; anneau de focus violet ; léger enfoncement (1px) à la pression.

### Chips
- **Badges d'état :** pilule de 20px, fond lavé + texte de la couleur d'état (attend orange, en cours bleu-vert, terminé vert éteint, erreur rouge). « À toi » : contour orange sans fond, point d'état en anneau, pour qu'une fin de tour ne se lise pas comme un blocage.
- **Groupes de bascule :** boutons outline `sm` espacés de 8px, pour les choix exclusifs (gabarit, mode git, période, mesure).

### Cards / Containers
- **Corner Style :** 12px.
- **Background :** `panel`, bordure `--edge` de 1px (transparente en clair, `hairline` en sombre). Les cartes spartan (`hlmCard`) reçoivent globalement `--elev-1` à la place de l'ombre `shadow-xs` et de l'anneau d'origine de spartan.
- **Shadow Strategy :** `--elev-1` au repos, `--elev-2` au survol d'une carte cliquable (voir Quiet-Relief). Un état recolore la bordure : `orange-line` + fond légèrement lavé d'orange pour un agent qui attend, `red-line` pour un souci ; survol cliquable = `hairline-strong`.
- **Internal Padding :** 14–18px ; 28px pour les formulaires en surimpression.
- Les panneaux regroupent des lignes séparées par des filets, pas des cartes empilées.

### Inputs / Fields
- **Style :** bordure `control` (3:1 sur le fond, WCAG 1.4.11), fond de page, 8px de rayon, 36px de haut. Les champs de commande et de chemin sont en mono, sur fond `abyss`.
- **Focus :** bordure et anneau violet.
- **Error :** bordure et texte rouge, message court sous le champ (« Choisis un dossier »).

### Navigation
- Barre latérale `nav-night` (sans fond pointillé), sessions groupées par état (attend → à toi → en cours → terminé, ce dernier repliable).
- Élément actif : fond `violet-wash`, barre d'état violette à gauche, icône et titre en violet.
- Session urgente : barre d'état orange, sous-titre orange en mono, point d'état qui pulse (coupé si « réduire les animations »).
- Replié : chaque session devient son initiale dans un carré de 22px, avec le point d'état en coin.

### Ligne de session (signature)
Une ligne de tableau cliquable en entier : badge d'état, titre + projet · branche, activité en cours, sparkline des 15 dernières minutes, agents, durée et coût alignés à droite en mono, actions à droite. Sparkline en bleu-vert (données). Urgente : fond orange lavé + barre d'état de 3px. Terminée : texte en retrait par la couleur (jamais par l'opacité), sparkline en gris.

### Dashboard (décision 041)
Route `/`, de haut en bas : indicateurs, activité, liste des sessions. Pas de section d'attente en tête (mise à jour du 2026-11-19) : une seule liste, triée par date de création (la plus récente en haut), où une session ne change jamais de place selon son état ; l'attente se voit à son badge orange, à son fond lavé et à ses actions (Autoriser, Répondre) dans la ligne. Recherche, sélection et suppression en lot portent sur toute la liste. Pas de graphique : ils vivent sur la page Consommation. Chaque section a un titre `h2` (16px, 600) posé sur le fond pointillé ; les indicateurs ont un titre `sr-only`.

### Carte d'indicateur
Carte `--elev-1`, 12px de rayon, 14px × 18px de padding, 10px entre les lignes : libellé en casse normale (13px, 600, `ink-soft`) précédé d'une icône SVG de 16px en `ink-faint` (violet au survol), gros chiffre en mono (24px, 500), barre segmentée, ligne de détail (12px, `ink-muted`, valeurs en mono `ink` 600). Cliquable quand elle mène à une page (Consommation) : `--elev-2` et `hairline-strong` au survol, focus violet. Grille de 4 colonnes, 2 sous 1200px, 1 sous 560px.
- **Couleur du rôle** (`data-tone`, variables `--tone` / `--tone-bg`) : Fenêtre 5 h et Tokens du jour = bleu-vert, Coût du jour = violet, Sessions = orange s'il y a une attente ou une fin de tour, sinon bleu-vert (Lights-Out).
- **Pastille** : en haut à droite (14px / 18px du bord), rond de 44px au fond lavé du rôle, icône **pleine** de 22px de la couleur du rôle (≥ 3:1 sur le lavé) : barres (Fenêtre), portefeuille (Coût), personnes (Sessions), base de données (Tokens). Décorative (`aria-hidden`) ; libellé et chiffre réservent 52px à droite.
- **Flèche de tendance** (SVG en trait, 14px) devant la ligne de détail : ↘ neutre avant « remise à zéro », ↗ rouge avant « limite vers » et « au-dessus de ton seuil » ; Coût et Tokens comparés à la moyenne 7 j : ↗ neutre, ↘ verte pour le coût (bonne nouvelle), neutre pour les tokens. Décorative : le texte dit la même chose.

### Barre segmentée
20 tirets de 6px de haut, 3px d'écart, rayon 2px ; vide = `hairline-strong`. Rempli de la couleur du rôle de la carte (bleu-vert pour Fenêtre et Tokens, violet pour Coût) ; au-delà d'un seuil, **rouge** (fenêtre de 5 h au-dessus de 80 %, toute la barre quand le coût du jour dépasse le seuil réglé). Jamais d'orange : approcher d'une limite n'est pas une attente. Variante Sessions : un tiret par session (au plus 24, largeur 24px au plus), couleur de son état (orange plein attend, contour orange à toi, bleu-vert en cours, vert éteint terminé). Les tirets restent des tirets (pas de barre continue ni de dégradé). Décorative (`aria-hidden`) : le chiffre et la ligne de détail portent l'information.

### Heatmap d'activité
Tokens par jour, une colonne par semaine (lundi en haut), autant de semaines que la largeur de la carte en tient (13 à 53), la semaine en cours à droite ; libellés de mois et lun / mer / ven en 11px `ink-faint`. Cases carrées de 14 à 26px (ajustées au pixel pour remplir la largeur ; au-delà de 53 semaines, ce sont les cases qui grandissent), même écart de 3px dans les deux sens, rayon 3px. Titre « Activité » précédé d'un éclair plein violet (18px) ; pied : icône info (cercle i, `ink-faint`) devant « Survole un jour pour voir son détail. ». Niveau 0 : simple point de 4px `ink-faint` (neutre) ; jours à venir de la semaine en cours : rien ; niveaux 1 à 4 = le bleu-vert (`--data`) mélangé à la carte à 75 / 83 / 92 / 100 % (niveau 1 = 3,0:1 en clair, 5,1:1 en sombre : `#087F8C` est plus clair que l'ancien pétrole, un lavé plus pâle passerait sous 3:1), attribués par rang parmi les jours actifs (quartiles). « Pic : 3,2 M tokens (14 janv.) » en tête à droite, légende Moins → Plus. Chaque case a un `title` (jour et tokens), la grille est `aria-hidden` et un résumé `sr-only` la remplace. Pic, jours actifs, série et résumé portent sur la plage affichée. En étroit, si 13 semaines de cases de 14px ne tiennent pas, la grille défile horizontalement, la semaine en cours visible.

### Bandeau de version
Pleine largeur en tête de la zone principale, 36px, fond `red-wash`, texte `red-err`, icône SVG : « Le daemon ne parle pas la même version que l'interface… ». Affiché quand une donnée du daemon ne respecte pas le contrat ; disparaît au premier snapshot valide. Au bureau, la coque en tient compte d'elle-même (la page prend la hauteur restante) ; sur téléphone, sa hauteur s'ajoute à `--chrome-top`, que retranchent le terminal et l'éditeur.

## Do's and Don'ts

### Do:
- **Do** passer par les variables CSS de `styles.css` (`--brand`, `--wait`, `--line`…) ou les jetons spartan dérivés ; jamais de hex dans un composant.
- **Do** utiliser `--dur-fast` (120 ms), `--dur` (200 ms) et `--ease` (`cubic-bezier(0.2, 0, 0, 1)` : sortie rapide, arrivée douce) pour toute transition.
- **Do** mettre en mono les montants, durées, tokens, branches, chemins et commandes, alignés à droite dans les tableaux.
- **Do** vérifier chaque nouvelle couleur de texte à 4,5:1 dans les deux thèmes, y compris sur `nav-night` et `panel-raised`.
- **Do** vérifier aussi les seuils non textuels avant d'ajouter un jeton : contrôles 3:1 sur le fond, couleurs de données (barres, sparklines) 3:1 sur `panel`, filets 1,33:1 sur `panel`.
- **Do** donner à chaque élément cliquable un survol (`--hover`), une pression (`--press`) et un focus visible violet.
- **Do** colorer une donnée en bleu-vert (`--data`), une seconde série en violet, le reste en neutres ; « en cours » en `--run`.
- **Do** poser du texte sombre (`--on-wait`) sur l'aplat orange, et utiliser `--wait` (variante sombre) pour tout texte, point ou trait orange en clair.
- **Do** réserver le seul mouvement signé de Vigie à l'arrivée d'une attente (classe `.wait-arrive` : l'orange arrive à 30 % puis se pose, `--dur-arrive` 900 ms, `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` ; barre d'état du tableau tracée en `scaleY`). Tout le reste reste du retour d'état en `--dur-fast` / `--dur`. Barres, jauges et sparklines bougent en `transform`, jamais en `width` / `height`.

### Don't:
- **Don't** utiliser l'orange pour autre chose qu'un état qui attend l'utilisateur, ni le vert pour autre chose que « terminé » / positif.
- **Don't** mettre un bouton principal dans une autre couleur que le violet, ni un bouton secondaire en violet plein.
- **Don't** introduire une teinte hors des trois couleurs et deux accents (plus de lilas pour les commandes : neutre mono).
- **Don't** atténuer du texte avec `opacity` : passer à `--text-muted` ou `--faint`.
- **Don't** poser d'ombre sur une ligne ou dans une liste dense, ni écrire une ombre à la main : `--elev-1` / `--elev-2` seulement.
- **Don't** empiler des cartes dans des cartes ; une liste dans un panneau se sépare par des filets.
- **Don't** utiliser d'emoji ou de caractères Unicode comme icônes : SVG en trait de 2px (1.8px pour les grandes icônes), `currentColor`.
