# 039 — Étude de faisabilité : tableau de bord, palette pétrole et relief léger

- **Statut :** Acceptée (lots 1 et 2) ; lot 1 décidé par la 040
- **Date :** 2026-11-18
- **Décidé par :** Toi
- **Remplacerait en partie :** 014 (palette OKLCH et cartes plates) et la règle *Flat-By-Default* de DESIGN.md

## Demande
1. Renommer la vue des sessions en **Dashboard** et s'inspirer de la maquette Dribbble « AI IDE Analytics Dashboard » (Demyanchuk Art Team).
2. Baser les couleurs sur la maquette Dribbble « Codex — AI Code Editor » (Repo S…).
3. Plus de relief : ombres légères teintées par la couleur principale, en thème clair et sombre.

Les deux maquettes sont des œuvres de tiers : on en reprend une **direction** (composition, palette, densité), jamais une copie pixel pour pixel ni leurs textes, logos ou icônes.

## Ce que montrent les maquettes (relevé dans le navigateur, couleurs mesurées sur les images)

**Dashboard (Demyanchuk)** : une rangée de trois cartes d'indicateurs (libellé + icône, gros chiffre « 48,20 $ / 100 $ », **barre segmentée** en tirets colorés par seuil vert / jaune / rouge, ligne de détail), une carte **Activité** en heatmap de contributions sur 6 mois (échelle de vert, « Pic : 3,2k tokens (14 janv.) » en mono), deux cartes de graphiques avec bascule de période (Tout / 7j / 1m / 6m / 1a) : courbe de tokens et barres par modèle. Cartes très claires (`#F9F9F7`) sur fond quasi noir, rayon ~16 px, vert émeraude `#00B46C` et ses lavis (`#6CCCA8`, `#B4E4CC`).

**Codex (Repo S…)** : thème clair très doux. Fond `#FCFCFC`, barre latérale et surfaces `#F0F0F0`, filets `#E4E4E4`, texte `#0C0C0C`, **couleur principale pétrole `#004854`** (bouton « Run », élément actif), accents rares cyan `#54C0C0` et ocre `#E4B460`, fond pointillé discret, cartes blanches à filet fin.

## Faisabilité

### 1. Dashboard — faisable sans toucher au daemon
Toutes les données existent déjà : snapshot (sessions, états, fenêtre 5 h, coût du jour) et `GET /api/usage?days=N` (historique jusqu'à 400 jours par jour × session × modèle, décision 025). Correspondance :

| Maquette | Dans Vigie |
|---|---|
| Cartes d'indicateurs avec barre segmentée | Fenêtre 5 h (% + heure de remise à zéro), Coût du jour (et moyenne 7 j), Sessions (en cours / **qui t'attendent**), Tokens du jour |
| Heatmap d'activité | Coût ou tokens par jour sur 26 semaines, depuis l'historique ; grille CSS, sans dépendance |
| Courbe « Additional tokens » + périodes | Graphique héros de la page Consommation (décision 028, Observable Plot déjà présent) réutilisé |
| « Usage by model » | Barres par modèle, déjà calculées pour Consommation |
| (absent de la maquette) | **La liste des sessions**, qui reste le cœur de la page |

Règle produit à garder (principe n° 1 de PRODUCT.md) : une session qui attend se voit en premier et se débloque en une action. Les sessions en attente passent donc **au-dessus** des indicateurs (bandeau ambre), le reste de la liste en dessous des graphiques ou dans une colonne à part en grand écran.

Coût : moyen. Une page nouvelle (cartes d'indicateurs, heatmap, réemploi des graphiques), renommage « Sessions » → « Dashboard » (titre de route, barre latérale ; la route `/` ne change pas). Le chargement initial ne grossit pas si Plot reste chargé à part (il l'est déjà) ; à surveiller : agréger l'historique côté UI sur 26 semaines (quelques milliers de lignes) ; si c'est lent, ajouter plus tard une route agrégée au daemon (additive, mineure).

### 2. Palette inspirée de Codex — faisable, mais trois arbitrages
Techniquement simple : tout passe par les variables de `ui/src/styles.css` (122 jetons, règle *Same-Role*), avec un jumeau clair et sombre. Proposition :

| Rôle | Clair | Sombre (à valider aux seuils) |
|---|---|---|
| Fond | `#FCFCFC` | nuit actuelle, teinte tirée vers le pétrole (OKLCH h ≈ 210, C ≤ 0,02) |
| Surface / barre latérale | `#FFFFFF` / `#F0F0F0` | strates actuelles retintées |
| Filet | `#E4E4E4` | idem, ≥ 1,33:1 |
| **Principale** | `#004854` (texte blanc ≈ 10:1) | pétrole éclairci ~`#5CC4C8` (≈ 9:1 sur le fond nuit) |
| Accents | cyan `#54C0C0`, ocre `#E4B460` | idem éclaircis |

Arbitrages :
- **Contraste** : le gris secondaire de Codex (`#A8A8A8` sur blanc ≈ 2,3:1) échoue au WCAG AA. On garde les niveaux de texte actuels de Vigie (`--faint` ≥ 4,5:1), retintés, pas ceux de la maquette.
- **Couleur = état** : aujourd'hui le bleu est à la fois la marque et l'état « en cours ». Avec une marque pétrole, soit l'état « en cours » devient pétrole (une couleur de moins, mais pétrole et vert « terminé » sont voisins : il faut alors éteindre davantage le vert), soit il reste bleu (deux accents froids à l'écran). Recommandation : « en cours » en pétrole, « terminé » vers un gris-vert peu saturé (il « s'éteint », comme le veut déjà DESIGN.md).
- **Ambre** : l'ocre de Codex est proche de l'ambre « attend » ; il ne doit pas servir d'accent décoratif (règle *Lights-Out*).

Coût : petit à moyen (valeurs des jetons, vérification des seuils dans les deux thèmes, captures avant / après), décision qui remplace la 014, mise à jour de DESIGN.md.

### 3. Relief léger teinté — faisable, à cadrer
Contredit la règle actuelle « aucune ombre au repos » (décision 014, *Flat-By-Default*) : il faut une décision qui la remplace. Proposition : deux jetons d'élévation, appliqués globalement aux cartes spartan et aux panneaux (une seule source, pas d'ombre par composant) :
- clair : `--elev-1: 0 1px 2px color-mix(in oklch, var(--brand) 10%, transparent), 0 4px 12px color-mix(in oklch, var(--brand) 6%, transparent)` ; `--elev-2` plus diffus pour les éléments survolés ou ouverts ;
- sombre : une ombre ne se voit presque pas sur fond nuit ; le relief passe par un **reflet haut** (`inset 0 1px 0` clair à 4–6 %) et un halo pétrole très faible (`0 0 0 1px` principale à 10–14 %, `0 8px 24px` principale à 8 %).

Garde-fous : jamais d'ombre sur une ligne de tableau ni dans les listes denses ; la barre d'état ambre / bleue reste un indicateur, pas une ombre ; les couleurs d'état ne servent jamais de teinte d'ombre.

Coût : petit (deux jetons, quelques sélecteurs globaux).

### Ce qu'on ne reprend pas des maquettes
- Cartes claires sur page sombre (mélange de thèmes) : chaque thème garde ses propres strates.
- Libellés en capitales espacées au-dessus de chaque carte (DESIGN.md les réserve aux en-têtes de colonnes).
- Fond pointillé de Codex partout : au mieux sur une zone vide, sinon bruit.

## Plan proposé (chaque lot livrable seul)
1. **Jetons et contraste** (palette pétrole, deux thèmes, seuils vérifiés, DESIGN.md, décision qui remplace la 014) — mineur.
2. **Élévation** (`--elev-1/2`, cartes et panneaux) — avec le lot 1.
3. **Dashboard** (renommage, cartes d'indicateurs, heatmap, graphiques réemployés, sessions en attente en tête) — mineur.
4. Captures avant / après aux deux tailles et aux deux thèmes, puis `/impeccable audit`.

## Questions
1. État « en cours » : pétrole (recommandé) ou bleu conservé ?
2. Heatmap : coût (en $) ou tokens par jour ?
3. Sur le Dashboard, la liste complète des sessions : sous les graphiques, ou en colonne à droite en grand écran ?
