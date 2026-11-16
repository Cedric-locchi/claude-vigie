---
name: Vigie
description: Tour de contrôle locale des sessions Claude Code — terminaux, agents, consommation.
colors:
  night: "#0d1116"
  abyss: "#070a0f"
  nav-night: "#11151b"
  panel: "#191f26"
  panel-raised: "#232932"
  hairline: "#2f363f"
  hairline-strong: "#414853"
  control: "#6d7580"
  ink: "#e8ebef"
  ink-soft: "#cdd1d8"
  ink-muted: "#abb2ba"
  ink-faint: "#9299a2"
  signal-blue: "#79b1f9"
  signal-blue-hover: "#98c7ff"
  signal-blue-wash: "#162537"
  amber-wait: "#ffbb49"
  amber-wait-hover: "#ffcc79"
  amber-wash: "#33230a"
  amber-line: "#664610"
  mint-ok: "#78c89e"
  mint-wash: "#13281d"
  coral-err: "#fc7a79"
  coral-wash: "#361919"
  coral-line: "#6c3434"
  lilac-cmd: "#bb99e3"
  slate-read: "#7488a1"
  on-signal: "#091018"
  on-amber: "#201301"
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
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-hover}"
  button-wait:
    backgroundColor: "{colors.amber-wait}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  button-wait-hover:
    backgroundColor: "{colors.amber-wait-hover}"
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
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber-wait}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-running:
    backgroundColor: "{colors.signal-blue-wash}"
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-done:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.mint-ok}"
    rounded: "{rounded.pill}"
    height: "20px"
    padding: "2px 8px"
  badge-issue:
    backgroundColor: "{colors.coral-wash}"
    textColor: "{colors.coral-err}"
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
  nav-item-active:
    backgroundColor: "{colors.signal-blue-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
---

# Design System: Vigie

## Overview

**Creative North Star: "La Tour de contrôle"**

Vigie est une salle de contrôle de nuit. Le fond est sombre et calme, presque silencieux ; l'information est dense mais rangée en lignes et en colonnes alignées, lisibles d'un balayage. La couleur n'est pas décorative : elle signale. Une session qui attend s'allume en ambre, une session qui travaille en bleu, une session finie s'éteint vers le vert ou le gris. Si rien n'attend, l'écran est presque monochrome, et c'est voulu.

L'interface s'efface derrière ce qu'elle surveille : terminaux, chronologies, chiffres de consommation. Les contrôles sont précis et retenus ; seule l'action qui débloque une session (Autoriser, Répondre) prend un aplat de couleur. La profondeur vient de strates de ton et de filets de 1px, jamais d'ombres posées sur des cartes. Le thème sombre est le thème par défaut ; un thème clair existe et reprend les mêmes rôles, valeur pour valeur.

**Key Characteristics:**
- Sombre par défaut, thème clair complet avec les mêmes rôles de couleur.
- Couleur = état. Ambre attend, bleu tourne, vert terminé, corail erreur, lilas commande.
- Dense et aligné : tableaux, colonnes de chiffres en mono, lignes de 12px de haut de padding.
- Plat : strates de fond et filets, une seule ombre réelle (les bulles flottantes).
- Micro-interactions courtes et identiques partout (120 ms / 200 ms, même courbe).

## Colors

Une nuit bleu-ardoise très désaturée, ponctuée de quatre signaux d'état et d'un accent bleu.

### Primary
- **Signal Blue** (`signal-blue`) : l'accent de Vigie. Action principale (Nouvelle session), lien, anneau de focus, élément de navigation actif, session en cours. Sa version lavée (`signal-blue-wash`) sert de fond à l'élément sélectionné.

### Secondary
- **Amber Wait** (`amber-wait`) : tout ce qui attend l'utilisateur — autorisation, question (plein), fin de tour (contour seul, sans fond : « à toi » ne bloque rien). Fond de ligne urgente (`amber-wash`), barre d'état, bouton Autoriser. C'est la couleur la plus importante de l'app : elle doit rester rare pour rester lisible.

### Tertiary
- **Mint OK** (`mint-ok`) : session ou agent terminé, ajout dans un diff.
- **Coral Err** (`coral-err`) : erreur, suppression, daemon injoignable.
- **Lilac Cmd** (`lilac-cmd`) : commandes shell et outils dans les chronologies.
- **Slate Read** (`slate-read`) : lectures et activité passée (sparklines des sessions finies).

### Neutral
- **Night** (`night`) : fond de page. **Abyss** (`abyss`) : fond le plus profond, terminaux et blocs de code. **Nav Night** (`nav-night`) : barre latérale et popovers.
- **Panel** / **Panel Raised** (`panel`, `panel-raised`) : surfaces de contenu, puis contrôles et zones survolées posés dessus.
- **Hairline** / **Hairline Strong** (`hairline`, `hairline-strong`) : filets de séparation (cartes, lignes, panneaux), puis bordures appuyées (survol, terminal). **Control** (`control`, `--control` / `--input`) : bordure des champs et contrôles, à 3:1 du fond (WCAG 1.4.11).
- **Ink** → **Ink Faint** : quatre niveaux de texte, du titre (`ink`) aux métadonnées (`ink-faint`). `ink-faint` reste au-dessus de 4,5:1 sur toutes les surfaces, dans les deux thèmes.

### Named Rules
**The Luminance-Hierarchy Rule.** Les accents ne sont pas égaux : leur clarté (OKLCH) suit l'urgence. Thème sombre : ambre « attend » L 0,84 (le plus lumineux de l'écran), corail L 0,73, bleu L 0,75, lilas L 0,74, menthe « terminé » L 0,77 mais moins saturée (C 0,10) pour s'effacer. Thème clair : tous vers L 0,50–0,52 pour tenir 4,5:1, la hiérarchie passe par la chroma et les fonds lavés.

**The Separation Rule.** Les strates se voient sans ombre : panneau/fond ≥ 1,14:1, filet/panneau ≥ 1,33:1, contrôle/fond ≥ 3:1, couleurs de données (barres, sparklines) ≥ 3:1 sur le panneau. Neutres teintés vers la marque (teinte OKLCH 255, chroma ≤ 0,02). Tout nouveau jeton passe ces seuils dans les deux thèmes avant d'être ajouté.

**The Lights-Out Rule.** Au repos, l'écran est neutre. Une couleur d'état n'apparaît que si l'état existe ; un écran sans session en attente ne contient pas d'ambre.

**The Same-Role Rule.** Chaque couleur a un jumeau dans le thème clair (`:root[data-theme='light']`). On n'écrit jamais de hex dans un composant : on passe par la variable CSS, et les composants spartan passent par les jetons sémantiques dérivés (`--primary`, `--muted`, `--border`…).

## Typography

**Body Font:** Inter (with system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo)

**Character:** Inter, neutre et compact, porte toute l'interface ; JetBrains Mono porte uniquement ce qui se mesure ou se tape — chiffres, coûts, durées, branches, chemins, commandes.

### Hierarchy
- **Headline** (600, 24px, -0.01em) : titre de page (Sessions, Consommation). Un seul par écran ; 20px dans les panneaux en surimpression (Nouvelle session).
- **Title** (600, 13–16px) : titre de session, nom d'agent, en-tête de carte.
- **Body** (400, 14px, 1.4) : texte courant. Le Markdown des rapports d'agents passe à 13px / 1.6.
- **Body small** (400, 12px) : sous-lignes, aides sous les champs, états.
- **Label** (600, 11px, 0.05em, majuscules) : en-têtes de colonnes et d'indicateurs uniquement.
- **Data** (JetBrains Mono 500, 24px) : valeurs d'indicateurs ; 11–12px dans les cellules de tableau.

### Named Rules
**The Measured-Mono Rule.** Le mono est réservé à ce qui se mesure ou se copie (montants, durées, tokens, branches, chemins, commandes). Jamais pour faire « technique ».

**The 11px Floor Rule.** 11px est le plus petit texte courant. 9–10px n'existe que pour les graduations de la chronologie et les valeurs au-dessus des barres du graphique.

## Layout

Une barre latérale repliable (18rem, ou icônes seules via ⌘B) et une zone de contenu. Sous 768px, la barre latérale devient un panneau ouvert par un bouton dans une barre mobile.

Les pages suivent un même gabarit : padding 28px / 36px / 40px (20px / 16px sous 720px), sections espacées de 24px, en-tête titre + outils à droite. Le contenu est rangé en tableaux à colonnes fixes plutôt qu'en grilles de cartes : la liste des sessions est une grille CSS de 8 colonnes qui en perd deux sous 1200px et passe sur deux lignes par session sous 820px.

Le rythme interne suit une échelle serrée : 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16px pour les gaps, 12px × 18px de padding pour les lignes de tableau et les indicateurs.

## Elevation & Depth

Vigie est plat. La profondeur vient de strates de fond — `abyss` < `night` < `panel` < `panel-raised` — et de filets de 1px. Le survol et la pression mélangent la surface vers la couleur du texte (`--hover` à 4 %, `--press` à 9 %, en `color-mix` oklch), ce qui fonctionne à l'identique dans les deux thèmes.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 8px 24px var(--shadow)`) : uniquement les bulles et infobulles qui flottent au-dessus du contenu.
- **State bar** (`box-shadow: inset 2px 0 0 var(--brand)` ; 3px dans les tableaux) : la barre d'état à gauche d'un élément actif (bleu) ou urgent (ambre / corail). Ce n'est pas une ombre de relief, c'est un indicateur.
- **Halo d'état** (`box-shadow: 0 0 0 3px var(--wait-bg)`) : anneau autour d'un point d'état, pour le détacher.

### Named Rules
**The Flat-By-Default Rule.** Aucune carte, ligne ou panneau ne porte d'ombre au repos. Une ombre signifie « flotte au-dessus » ; rien d'autre.

## Shapes

Des angles doux et sobres, croissant avec la taille du conteneur : 12px pour les grands panneaux (tableau des sessions, indicateurs, terminal, diff), 10px pour les tours de la chronologie, 8px pour les boutons, champs et popovers, 6px pour les éléments de liste, 4px pour les petits marqueurs. Les badges d'état sont des pilules. Exception volontaire : les lignes de navigation de la barre latérale sont à angle droit, pour que la barre d'état de gauche reste droite.

## Components

### Buttons
Précis et retenus.
- **Shape :** coins doux (8px), hauteur 36px (32px en `sm`, 40px en `lg`).
- **Primary :** aplat Signal Blue, texte nuit. Une seule par écran (Nouvelle session, Lancer la session).
- **Wait :** aplat ambre, texte gras — réservé aux actions qui débloquent une session (Autoriser, Répondre, Reprendre une session urgente).
- **Outline / Ghost :** actions secondaires et icônes. Le ghost de suppression vire au corail au survol.
- **Hover / Focus :** transition 120 ms ; anneau de focus Signal Blue ; léger enfoncement (1px) à la pression.

### Chips
- **Badges d'état :** pilule de 20px, fond lavé + texte de la couleur d'état (attend, en cours, terminé, erreur). « À toi » : contour ambre sans fond, point d'état en anneau, pour qu'une fin de tour ne se lise pas comme un blocage.
- **Groupes de bascule :** boutons outline `sm` espacés de 8px, pour les choix exclusifs (gabarit, mode git, période, mesure).

### Cards / Containers
- **Corner Style :** 12px.
- **Background :** `panel`, bordure `hairline` de 1px. Les cartes spartan (`hlmCard`) sont aplaties globalement : ni l'ombre `shadow-xs` ni l'anneau d'origine de spartan.
- **Shadow Strategy :** aucune (voir Flat-By-Default). Un état recolore la bordure : `amber-line` + fond légèrement lavé d'ambre pour un agent qui attend, `coral-line` pour un souci ; survol cliquable = `hairline-strong`.
- **Internal Padding :** 14–18px ; 28px pour les formulaires en surimpression.
- Les panneaux regroupent des lignes séparées par des filets, pas des cartes empilées.

### Inputs / Fields
- **Style :** bordure `control` (3:1 sur le fond, WCAG 1.4.11), fond de page, 8px de rayon, 36px de haut. Les champs de commande et de chemin sont en mono, sur fond `abyss`.
- **Focus :** bordure et anneau Signal Blue.
- **Error :** bordure et texte corail, message court sous le champ (« Choisis un dossier »).

### Navigation
- Barre latérale `nav-night`, sessions groupées par état (attend → à toi → en cours → terminé, ce dernier repliable).
- Élément actif : fond `signal-blue-wash`, barre d'état bleue à gauche, icône et titre en bleu.
- Session urgente : barre d'état ambre, sous-titre ambre en mono, point d'état qui pulse (coupé si « réduire les animations »).
- Replié : chaque session devient son initiale dans un carré de 22px, avec le point d'état en coin.

### Ligne de session (signature)
Une ligne de tableau cliquable en entier : badge d'état, titre + projet · branche, activité en cours, sparkline des 15 dernières minutes, agents, durée et coût alignés à droite en mono, actions à droite. Urgente : fond ambre lavé + barre d'état de 3px. Terminée : texte en retrait par la couleur (jamais par l'opacité), sparkline en ardoise.

### Bandeau de version
Pleine largeur en tête de la zone principale, 36px, fond `coral-wash`, texte `coral-err`, icône SVG : « Le daemon ne parle pas la même version que l'interface… ». Affiché quand une donnée du daemon ne respecte pas le contrat ; disparaît au premier snapshot valide. Sa hauteur s'ajoute à `--chrome-top` pour que les vues pleine hauteur ne débordent pas.

## Do's and Don'ts

### Do:
- **Do** passer par les variables CSS de `styles.css` (`--brand`, `--wait`, `--line`…) ou les jetons spartan dérivés ; jamais de hex dans un composant.
- **Do** utiliser `--dur-fast` (120 ms), `--dur` (200 ms) et `--ease` (`cubic-bezier(0.2, 0, 0, 1)` : sortie rapide, arrivée douce) pour toute transition.
- **Do** mettre en mono les montants, durées, tokens, branches, chemins et commandes, alignés à droite dans les tableaux.
- **Do** vérifier chaque nouvelle couleur de texte à 4,5:1 dans les deux thèmes, y compris sur `nav-night` et `panel-raised`.
- **Do** vérifier aussi les seuils non textuels avant d'ajouter un jeton : contrôles 3:1 sur le fond, couleurs de données (barres, sparklines) 3:1 sur `panel`, filets 1,33:1 sur `panel`.
- **Do** donner à chaque élément cliquable un survol (`--hover`), une pression (`--press`) et un focus visible Signal Blue.
- **Do** réserver le seul mouvement signé de Vigie à l'arrivée d'une attente (classe `.wait-arrive` : l'ambre arrive à 30 % puis se pose, `--dur-arrive` 900 ms, `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` ; barre d'état du tableau tracée en `scaleY`). Tout le reste reste du retour d'état en `--dur-fast` / `--dur`. Barres, jauges et sparklines bougent en `transform`, jamais en `width` / `height`.

### Don't:
- **Don't** utiliser l'ambre pour autre chose qu'un état qui attend l'utilisateur.
- **Don't** atténuer du texte avec `opacity` : passer à `--text-muted` ou `--faint`.
- **Don't** poser d'ombre sur une carte, une ligne ou un panneau au repos.
- **Don't** empiler des cartes dans des cartes ; une liste dans un panneau se sépare par des filets.
- **Don't** utiliser d'emoji ou de caractères Unicode comme icônes : SVG en trait de 2px (1.8px pour les grandes icônes), `currentColor`.
