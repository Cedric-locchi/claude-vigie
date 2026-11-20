---
name: vigie-archi-review
description: Revue d'architecture de Vigie (daemon Node.js par node-architect, UI Angular par angular-architect, en parallèle), sans rien modifier. À utiliser quand l'utilisateur demande une revue ou un audit d'architecture, un état des lieux du backend ou du frontend, ou tape /vigie-archi-review, éventuellement suivi d'un fichier, d'un côté (back, front) ou d'un sujet.
argument-hint: "[back | front | fichier, module ou sujet ; vide = tout le dépôt]"
---

Cible : $ARGUMENTS (vide = back et front en entier).

1. **Répartis** : back = `daemon/`, `bin/`, `electron/`, `contract/`, `scripts/`, `plugins/*/index.mjs` et `contract.mjs` → `node-architect` ; front = `ui/src/`, `ui/src/plugin-sdk/`, `plugins/*/ui/`, config UI → `angular-architect`. Une cible qui touche les deux côtés lance les deux agents **en parallèle** (un seul message, deux appels).
2. **Brief** de chaque agent, en mode **revue** : la cible et son périmètre exact (ce que l'autre agent couvre est hors périmètre, sauf incohérence du contrat vue de son côté), les références à lire (`CLAUDE.md`, `daemon/ARCHITECTURE.md` ou `DESIGN.md` + `ui/README.md`, les décisions du sujet), l'exigence de lancer tests et lint, et le format : constats P0 → P3 avec `fichier:ligne`, vérifié / supposé séparés, ce qui est sain.
3. **Vérifie toi-même** chaque constat P0/P1 en ouvrant le code cité : écarte ceux qui ne tiennent pas, et dis-le.
4. **Rapporte** une synthèse unique : état des tests et du lint, puis constats confirmés classés P0 → P3 (back et front mêlés par gravité), chacun avec `fichier:ligne`, la conséquence concrète et la correction proposée ; les constats communs aux deux côtés regroupés ; les soupçons non confirmés à part ; les choix qui reviennent à l'utilisateur signalés comme tels. Termine par les points forts à préserver.

Ne corrige rien. Propose ensuite `/vigie-feature` pour traiter les constats que l'utilisateur choisit. Si un même type de constat revient d'un audit à l'autre, propose aussi de le faire porter par une règle ESLint ou par les consignes des agents (`.claude/agents/`).
