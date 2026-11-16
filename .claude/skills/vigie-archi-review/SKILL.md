---
name: vigie-archi-review
description: Revue d'architecture du daemon Node.js de Vigie par l'agent node-architect, sans rien modifier. À utiliser quand l'utilisateur demande une revue d'architecture, un état des lieux du backend, ou tape /vigie-archi-review, éventuellement suivi d'un fichier ou d'un sujet.
argument-hint: "[fichier, module ou sujet ; vide = tout le daemon]"
---

Cible : $ARGUMENTS (vide = `daemon/`, `bin/` et `electron/` en entier).

1. Lance `node-architect` en mode **revue** sur la cible. Brief : la cible, et pour une revue complète, demande-lui de lire chaque module et de lancer `node --test daemon/*.test.mjs`.
2. Vérifie toi-même chaque constat P0/P1 en ouvrant le code cité : écarte ceux qui ne tiennent pas, et dis-le.
3. Rapporte le verdict et les constats confirmés, classés P0 → P3, chacun avec `fichier:ligne`, la conséquence concrète et la correction proposée. Termine par les points forts à préserver.

Ne corrige rien. Propose ensuite `/vigie-feature` pour traiter les constats que l'utilisateur choisit.
