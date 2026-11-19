# 042 — Palette à trois couleurs : violet, bleu-vert, orange

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi
- **Remplace :** la partie palette de la 040 (le relief `--elev-1/2` et le fond pointillé de la 040 restent)

## Contexte
La palette pétrole de la 040 gardait six teintes (pétrole, ambre, vert, corail, lilas, ardoise). Tu veux une palette réduite : trois couleurs à rôles fixes et deux accents seulement, et des widgets du Dashboard plus parlants (pastilles colorées, icônes).

## Décision
**Rôles** (jetons dans `ui/src/styles.css`, règle Same-Role ; valeurs données = aplats et données en clair) :

| Rôle | Clair | Sombre | Jeton | Usage |
|---|---|---|---|---|
| Principale | `#635BDB` | `#9B9EFF` | `--brand` | Identité, bouton principal, focus, navigation active, liens, sélection, éditions |
| Secondaire | `#087F8C` | `#69C8D6` | `--data` | Données : heatmap, tirets des indicateurs, jauges, sparklines, graphiques (+ violet en seconde série) |
| « En cours » | `#006570` | `#69C8D6` | `--run` | État en cours (badge, point, barre d'état) ; variante texte de la secondaire en clair |
| Tertiaire (aplat) | `#E69A45` | `#FFB864` | `--wait-fill` | Bouton Autoriser, compteur de la cloche ; texte sombre `--on-wait` dessus |
| Tertiaire (texte, traits) | `#A25B00` | `#FFB864` | `--wait` | « Attend l'utilisateur » : texte, points, barres, tirets |
| Positif | `#4A714B` | `#8AA88A` | `--ok` | Terminé, ajout dans un diff (inchangé) |
| Erreur | `#A51E23` | `#FC7A79` | `--err` | Erreur, suppression, daemon injoignable, au-delà d'un seuil |

- Variantes de nuit : même teinte OKLCH (violet h 281, bleu-vert h 207, orange h 66), clarté relevée.
- **Lilas supprimé** (`--cmd`, `--on-cmd`) : trop proche du violet. Commandes en neutre mono (`--text-2`) dans les chronologies, le lanceur de tâches et le journal ; au survol d'une ligne du lanceur, la commande prend le violet. Fichiers modifiés et éditions : violet ; agents dans les chronologies : bleu-vert ; renommé (`R`) d'un diff : neutre.
- **Ardoise** « lecture » devenue gris neutre (`--read` : `#616B6D` / `#8A9496`), séparé de `--neutral` par la clarté.
- Graphiques : familles opus violet, sonnet bleu-vert, haiku gris, fable `--text-2` ; coût par agent : violet, bleu-vert, puis neutres.
- **Relief** : clair = ombre **neutre** (couleur du texte à 11/13/17 % et 13/19/21 %, même densité que le pétrole de la 040) ; sombre = inchangé, teinté de la principale (violet). Neutres de fond et pointillé inchangés.
- **Widgets du Dashboard** : chaque carte d'indicateur a une couleur de rôle (Fenêtre, Tokens : bleu-vert ; Coût : violet ; Sessions : orange seulement s'il y a une attente, sinon bleu-vert), une pastille ronde de 44px au fond lavé du rôle avec une icône pleine, des tirets de la couleur du rôle (toujours segmentés, rouge au-delà du seuil), une flèche de tendance devant la ligne de détail. Carte Activité : éclair violet devant le titre, heatmap en bleu-vert, icône info dans le pied. Rayon inchangé (12px).
- Hors UI : le fond de la fenêtre Electron au démarrage suit `--bg` (`#0b1214` / `#fcfcfc`) ; la sélection du terminal (xterm) passe au violet (`#36366b` / `#d0d4ff`), couleurs ANSI inchangées.

## Raisons
- Mesuré par script (WCAG 2.x, `colorjs.io` déjà présent dans `node_modules`) dans les deux thèmes : textes `--brand`, `--run`, `--wait`, `--ok`, `--err` ≥ 4,5:1 sur fond, barre latérale, panneau et `panel-raised` (minimum : violet clair 4,55:1, orange clair 4,57:1) ; texte sur aplat ≥ 4,5:1 (blanc sur violet 5,19:1, `--on-wait` sur orange 7,85:1) ; badges ≥ 4,5:1 sur leur lavé ; pastilles ≥ 3:1 ; focus et contrôles ≥ 3:1 ; données ≥ 3:1 sur le panneau (heatmap niveau 1 : 3,04:1 en clair).
- `#E69A45` ne fait que 2,3:1 sur blanc : il reste l'aplat (texte sombre dessus), et `--wait` en est la variante sombre pour le texte et les traits.
- `#087F8C` tient 4,75:1 sur blanc mais 4,2:1 sur `panel-raised` : `--run` (#006570) en est la variante texte, `--data` garde la couleur donnée.
- Distinction des états en teinte **et** en clarté. Sombre : attend 0,83 · en cours 0,78 · erreur 0,73 · terminé 0,70. Clair : attend 0,54 · terminé 0,51 · erreur 0,47 · en cours 0,46 ; les paires de teinte voisine (en cours / terminé, attend / erreur) sont écartées de 0,05 à 0,07. Le rouge clair passe donc de `#BA2B2E` à `#A51E23`.
- « En cours » en bleu-vert : continuité avec le pétrole de la 040, et le violet reste aux actions.
- Ombre neutre en clair : le violet (L 0,55, chroma 0,19) est plus clair et bien plus saturé que le pétrole ; au même dosage il donne un halo lavande autour des cartes, contraire à « cartes majoritairement blanches ».

## Alternatives écartées
- Garder le lilas pour les commandes : deux violets voisins à l'écran.
- `#E69A45` en texte : illisible en clair.
- Heatmap de 55 % à 100 % comme en 040 : en clair, le niveau 1 tomberait à 2,2:1.
- Barres continues avec dégradé pour les indicateurs : écartées par toi, les tirets restent.

## Conséquences
- `DESIGN.md` : couleurs (front-matter et section Colors), règles nommées (Luminance-Hierarchy, Lights-Out, nouvelle Three-Colors), Elevation (clair neutre), composants (boutons, badges, navigation, carte d'indicateur, pastille, barre segmentée, heatmap), Do/Don't.
- Kit spartan (`ui/libs/ui`) touché sur trois variantes : badge `running` (`--data-bg` / `--run`), bouton `wait` (`--wait-fill`), indicateur de progression (`--data` au lieu de la principale : c'est une jauge).
- 040 passe en « Acceptée (palette remplacée par 042) ».
