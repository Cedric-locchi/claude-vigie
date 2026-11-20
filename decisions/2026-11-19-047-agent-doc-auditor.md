# 047 — Agent `doc-auditor` : la doc vérifiée contre le code en fin de session

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi (« faire un agent qui va check en fin de session s'il y a des dérives entre la doc et le code »)
- **Complète :** la 002 et la 045 (agents et skills du projet)

## Contexte
Les deux revues d'architecture du 2026-11-19 ont surtout trouvé des dérives de doc : des `.md` qui promettaient plus que le code (règles « vérifiées par ESLint » contournables, consignes d'agents plus strictes que le code), des listes et des valeurs périmées, un index de décisions en retard. Les architectes ne relisent la doc qu'en passant, chacun pour son côté.

## Décision
- **Cinquième agent** `doc-auditor` (`.claude/agents/`), en lecture seule : il compare chaque `.md` du dépôt (`CLAUDE.md`, `README.md`, `PRODUCT.md`, `DESIGN.md`, `daemon/ARCHITECTURE.md`, `ui/README.md`, `docs/`, index des décisions, fiches d'agents, skills) au code et rend chaque dérive avec un texte de remplacement prêt à coller.
- **Le code fait foi** : la doc suit le code. Deux cas à part : un code qui viole une règle non négociable ou une décision (c'est le code qui change) ; un fichier de décision contredit par le code (il ne se réécrit pas : nouvelle décision ou correction du code ; seul l'index se met à jour).
- **Fin de session** : toute session qui modifie le code passe `doc-auditor` sur les fichiers changés avant le bump de version (étape de `/vigie-feature`), corrige les dérives dans la même session et le relance jusqu'à « conforme ».
- **Mode complet** (« tout ») sur demande.

## Alternatives écartées
- Un hook `Stop` de Claude Code qui relance l'audit : il se déclencherait à chaque réponse, pas en fin de session, et coûterait un audit par tour.
- Laisser la doc aux seuls architectes : les deux dernières revues montrent que la relecture par côté et en passant ne suffit pas.
- Un script (liens, chemins) : il ne voit que l'existence, ni les comportements ni les promesses des outils.

## Conséquences
- `CLAUDE.md` impose le passage en fin de session ; `/vigie-feature` en fait une étape.
- Une nouvelle fiche d'agent n'est chargée qu'au démarrage suivant de Claude Code ; d'ici là, un agent généraliste qui suit la fiche la remplace.
