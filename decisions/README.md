# Journal des décisions

Une décision technique ou produit par fichier, nommé `AAAA-MM-JJ-NNN-titre.md` (date de la décision, puis numéro jamais réattribué). Pour changer une décision, on en écrit une nouvelle qui la **remplace** (et on passe l'ancienne au statut « Remplacée par NNN »).

**Statuts :** *Acceptée* (tu l'as prise), *Acceptée par défaut* (proposée, appliquée sans objection), *Proposée* (en attente de ton choix), *Remplacée par NNN*.

| # | Décision | Statut | Date |
|---|---|---|---|
| [001](2026-11-11-001-public-et-perimetre-produit.md) | Vigie est un outil d'équipe, centré sur trois usages à égalité | Acceptée | 2026-11-11 |
| [002](2026-11-11-002-agents-et-skills-claude-code.md) | Des agents et des skills Claude Code dédiés au projet | Acceptée (complétée par 045 et 047) | 2026-11-11 |
| [003](2026-11-11-003-pas-de-clean-architecture.md) | Pas de Clean Architecture : un découpage léger, rendu explicite | Acceptée | 2026-11-11 |
| [004](2026-11-11-004-contrat-zod-partage.md) | Le contrat daemon ↔ UI vit dans des schémas Zod partagés (`contract/`) | Acceptée | 2026-11-11 |
| [005](2026-11-11-005-zod-mini.md) | Toujours `zod/mini`, jamais l'import complet de Zod | Acceptée | 2026-11-11 |
| [006](2026-11-11-006-signal-forms-zod.md) | Les vrais formulaires passent en signal forms validés par Zod | Acceptée | 2026-11-11 |
| [007](2026-11-11-007-workspaces-npm.md) | Workspaces npm (pas pnpm, pas Nx) | Acceptée | 2026-11-11 |
| [008](2026-11-11-008-plateformes-macos-linux-wsl.md) | Cibles : macOS et Linux ; Windows via WSL | Acceptée | 2026-11-11 |
| [009](2026-11-11-009-pas-de-ci-pour-l-instant.md) | Pas de CI pour l'instant | Acceptée | 2026-11-11 |
| [010](2026-11-11-010-fermeture-fenetre-linux.md) | Sous Linux, fermer la fenêtre quitte l'app | Acceptée | 2026-11-11 |
| [011](2026-11-11-011-securite-du-daemon.md) | Durcissement du daemon local | Acceptée (complétée par 044) | 2026-11-11 |
| [012](2026-11-11-012-purge-des-discussions.md) | Exception unique : les discussions sont effacées de `~/.claude` | Acceptée par défaut (documentée, sans objection de ta part) | 2026-11-11 |
| [013](2026-11-11-013-polices-embarquees.md) | Polices embarquées au lieu de Google Fonts | Acceptée | 2026-11-11 |
| [014](2026-11-11-014-palette-oklch-et-cartes-plates.md) | Nouvelle palette OKLCH et cartes spartan plates | Remplacée par 040 | 2026-11-11 |
| [015](2026-11-12-015-mouvement-signe.md) | Un seul mouvement signé : l'arrivée d'une attente | Acceptée | 2026-11-12 |
| [016](2026-11-11-016-budget-bundle-720k.md) | Budget du chargement initial porté à 720 kB | Remplacée par 026 | 2026-11-11 |
| [017](2026-11-12-017-lib-de-graphiques.md) | Une lib de graphiques pour comparer les modèles | Acceptée (comparaisons tranchées avec la 025) | 2026-11-12 |
| [018](2026-11-12-018-electron-vs-tauri.md) | Garder Electron (pas de Tauri pour l'instant) | Acceptée | 2026-11-12 |
| [019](2026-11-12-019-brancher-une-session-ouverte.md) | Nouvelle branche ou worktree depuis une session ouverte | Acceptée | 2026-11-12 |
| [020](2026-11-12-020-hooks-http.md) | Hooks HTTP vers le daemon plutôt qu'un process node par événement | Remplacée par 021 | 2026-11-12 |
| [021](2026-11-12-021-retour-aux-hooks-command.md) | Retour aux hooks `node hook.mjs` (proxy du sandbox) | Acceptée | 2026-11-12 |
| [022](2026-11-12-022-explorateur-de-fichiers.md) | Explorateur de fichiers du projet d'une session | Acceptée | 2026-11-12 |
| [023](2026-11-12-023-coloration-syntaxique.md) | Coloration syntaxique dans l'explorateur de fichiers | Acceptée (limite d'édition levée par 027) | 2026-11-12 |
| [024](2026-11-13-024-statut-claude.md) | Statut de Claude (status.claude.com) : seule requête sortante | Acceptée (complétée par 046 : deuxième exception, `claude -p` sur clic) | 2026-11-13 |
| [025](2026-11-13-025-historique-de-consommation.md) | Historique de consommation conservé dans `~/.vigie/usage.json` | Acceptée | 2026-11-13 |
| [026](2026-11-13-026-budget-bundle-740k.md) | Budget du chargement initial porté à 740 kB | Remplacée par 036 | 2026-11-13 |
| [027](2026-11-13-027-onglet-fichiers-facon-ide.md) | Onglet Fichiers façon IDE léger, éditeur coloré sans dépendance (remplace la limite « textarea brute » de la 023) | Acceptée (limite « pas de recherche intégrée » levée par 049) | 2026-11-13 |
| [028](2026-11-13-028-graphique-heros-consommation.md) | Un graphique principal pour la page Consommation | Acceptée | 2026-11-13 |
| [029](2026-11-13-029-selecteur-projets.md) | Sélecteur de projet : GET /api/projects remplace /api/dirs | Acceptée | 2026-11-13 |
| [030](2026-11-13-030-onglet-xcode.md) | Onglet Xcode : frontière de plateforme par l’outil, DerivedData sous ~/.vigie/xcode | Acceptée (onglet devenu plugin, DerivedData remplacé par 035) | 2026-11-13 |
| [031](2026-11-16-031-arborescence-ui-un-dossier-par-composant.md) | Arborescence de l’UI : un dossier par composant | Acceptée | 2026-11-16 |
| [032](2026-11-17-032-eslint.md) | ESLint sur le code Node (daemon, contract, bin, electron) | Acceptée | 2026-11-17 |
| [033](2026-11-17-033-eslint-ui.md) | ESLint sur l'UI Angular (angular-eslint, typescript-eslint) | Acceptée | 2026-11-17 |
| [034](2026-11-18-034-systeme-de-plugins.md) | Système de plugins : de nouveaux onglets de session, vue déclarative rendue par l'UI, plugins locaux activés d'un clic | Acceptée (alias remplacés par 035, vue déclarative par 037) | 2026-11-18 |
| [035](2026-11-18-035-retrait-direct-des-routes-mise-xcode.md) | Retrait direct des routes mise et Xcode, sans alias ; DerivedData sous `~/.vigie/plugins-data/xcode` | Acceptée | 2026-11-18 |
| [036](2026-11-18-036-budget-bundle-800k.md) | Budget du chargement initial porté à 800 kB | Acceptée | 2026-11-18 |
| [037](2026-11-18-037-front-des-plugins-en-angular.md) | Le plugin porte son front : composants Angular compilés avec l'app, prêts pour Native Federation (remplace la vue déclarative de la 034) | Acceptée | 2026-11-18 |
| [038](2026-11-18-038-plugins-npm-et-nx.md) | Plugins npm et Nx : lecture sans process pour npm, `nx graph` sans réseau ni écriture dans le dépôt, refus si télémétrie Nx | Acceptée | 2026-11-18 |
| [039](2026-11-18-039-etude-refonte-visuelle-dashboard.md) | Étude : Dashboard, palette pétrole et relief léger teinté | Acceptée (lots 1 et 2) | 2026-11-18 |
| [040](2026-11-18-040-palette-petrole-relief-et-points.md) | Palette pétrole, relief léger teinté et fond pointillé (remplace la 014) | Acceptée (palette remplacée par 042 ; complétée par 043) | 2026-11-18 |
| [041](2026-11-18-041-dashboard.md) | La page Sessions devient le Dashboard (indicateurs, heatmap des tokens, graphiques) | Acceptée | 2026-11-18 |
| [042](2026-11-19-042-palette-trois-couleurs.md) | Palette à trois couleurs (violet, bleu-vert, orange) + vert et rouge ; pastilles des indicateurs (remplace la palette de la 040) | Acceptée (complétée par 043) | 2026-11-19 |
| [043](2026-11-19-043-panneaux-detaches-et-icones-de-fichiers.md) | Barre latérale et vues en panneaux détachés sur le fond pointillé ; icônes de types de fichiers colorées (exception aux trois couleurs) | Acceptée | 2026-11-19 |
| [044](2026-11-19-044-csp-et-images-du-markdown.md) | CSP servie par le daemon, images distantes du Markdown remplacées par leur texte | Acceptée | 2026-11-19 |
| [045](2026-11-19-045-architecte-angular-et-revue-complete.md) | Agent `angular-architect` en lecture seule ; `/vigie-archi-review` sur le back et le front ; règles de l'audit dans les fiches d'agents et ESLint (complète la 002) | Acceptée (complétée par 047) | 2026-11-19 |
| [046](2026-11-19-046-suggestion-de-commit-par-claude.md) | Suggestion de message de commit par `claude -p` : deuxième exception au « local uniquement », sur geste explicite seulement | Acceptée | 2026-11-19 |
| [047](2026-11-19-047-agent-doc-auditor.md) | Agent `doc-auditor` en lecture seule : la doc vérifiée contre le code en fin de toute session qui modifie le code (complète la 002 et la 045) | Acceptée | 2026-11-19 |
| [048](2026-11-19-048-multilangue-transloco.md) | Multilangue de l'UI : Transloco, français (source) et anglais, langue choisie dans Réglages ; traduction page par page, Réglages d'abord | Acceptée | 2026-11-19 |
| [049](2026-11-20-049-recherche-dans-les-sessions.md) | Recherche : ⌘F dans le fichier ouvert (barre, surlignage), ailleurs palette qui cherche dans toutes les sessions du snapshot (`GET /api/search`, cache du journal porté à 200 pistes ; lève la limite « pas de recherche intégrée » de la 027) | Acceptée | 2026-11-20 |
| [050](2026-11-22-050-l-app-possede-son-daemon.md) | L'app possède son daemon : elle remplace un daemon déjà lancé, ne réutilise plus le service | Acceptée | 2026-11-22 |

## En attente de ton choix

Rien pour l'instant.

## Actions de suivi

- **016 / 026** : étudier la réduction de la taille du bundle front.

## Modèle pour une nouvelle décision

Nomme le fichier `AAAA-MM-JJ-NNN-titre.md` (prochain numéro libre) et copie le format d'un fichier existant : Statut, Date, Décidé par, Contexte, Décision, Raisons, Alternatives écartées, Conséquences.
