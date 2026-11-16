# 023 — Coloration syntaxique dans l'explorateur de fichiers

- **Statut :** Acceptée
- **Date :** 2026-11-12
- **Décidé par :** Toi (demande), Claude (choix de la bibliothèque)

## Contexte
L'onglet Fichiers (décision 022) affiche le contenu en texte brut : un fichier de code se lit mal.

## Décision
Nouvelle dépendance UI `highlight.js` (v11), importée par son cœur (`highlight.js/lib/core`) avec une liste fermée de langages dans `ui/src/app/core/highlight.ts`. Le langage est déduit de l'extension (alias de highlight.js : `mjs`, `yml`, `md`, `toml`…). Langage inconnu : texte brut comme avant. Couleurs = jetons du thème (`--cmd`, `--ok`, `--wait`, `--brand`, `--faint`), aucune feuille de style de highlight.js.

## Raisons
- Écrire un coloriseur à la main pour une dizaine de langages n'est pas raisonnable ; highlight.js n'a aucune dépendance, tourne hors ligne et échappe le HTML.
- Shiki (grammaires TextMate + WASM) colore mieux mais pèse beaucoup plus lourd pour une vue en lecture seule.
- Cœur + langages choisis seulement, pas les quelque 190 langages du paquet complet.

## Limites
- Lecture seule : l'édition reste une `<textarea>` brute. *(Levée par la 027 : éditeur coloré par superposition.)*
- L'onglet Diff n'est pas coloré.
- Fichiers sans extension (`Makefile`, `Dockerfile`, `.gitignore`) non colorés.
