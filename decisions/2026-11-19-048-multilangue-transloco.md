# 048 — Multilangue de l'UI : Transloco, français et anglais

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi (Transloco ; français + anglais ; langue choisie dans Réglages, celle du système par défaut ; infrastructure + une page en exemple)

## Contexte
L'UI n'existe qu'en français (`PRODUCT.md`), alors que l'outil sert à des développeurs qui ne lisent pas tous le français.

## Décision
- **Transloco** (`@jsverse/transloco` 8.4, devDependency de `ui`). Langues : français (source) et anglais.
- **Catalogues** dans `ui/src/i18n/{fr,en}.json`, chargés par `import()` : un chunk haché par langue, seul celui de la langue active est chargé, rien dans le chargement initial.
- **Langue** : `localStorage` `vigie-lang`, sinon `navigator.language` (`fr*` → français, sinon anglais). Réglée dans Réglages (première section) ; `<html lang>` suit. L'initialiseur de l'app attend le catalogue actif : pas de clé ni de flash de français au premier rendu. Changer de langue ne recharge pas la page.
- **Clés** : JSON imbriqué, premier niveau = la feature (`settings`, puis `sessions`, `session`, `usage`, `newSession`, `plugins`, `shell`) ; clés camelCase anglais qui disent le rôle, jamais le texte ; valeurs en texte brut avec `{{ param }}`, **jamais de HTML** (décision 044) : un morceau mis en forme coupe la phrase en `xxxBefore` / `xxxAfter`. Français au tutoiement.
- **Traduction page par page**, Réglages d'abord. Ce qui reste en français est listé par le `ponytail:` de `ui/src/app/core/language.service.ts` (autres pages et coque, titres de route, messages d'erreur du daemon et du contrat, dialogues d'Electron, plugins, pluriels) ; les formats de nombre et de date restent en `fr-FR` (`ponytail:` de `core/format.ts`).
- **Plugins, plus tard** : catalogues dans `plugins/<id>/ui/i18n/{fr,en}.json`, branchés par une aide du SDK (scope Transloco au nom du plugin) ; un plugin n'importe jamais `@jsverse/transloco` directement (liste d'autorisés d'ESLint, décision 037).
- **Specs** : `ui/src/test-providers.ts` (option `providersFile`) fournit les deux catalogues à chaque TestBed, français actif ; une clé absente fait échouer le spec ; un test vérifie que `fr.json` et `en.json` ont les mêmes clés et les mêmes paramètres.

## Raisons
- Transloco : changement de langue sans rechargement, un seul build, langue active en signal, module de test documenté.
- `import()` plutôt qu'un dossier `public/i18n/` lu par HTTP : pas de `HttpClient` hors de `VigieService`, noms hachés (pas de catalogue périmé après une mise à jour), `script-src 'self'` suffit sous la CSP.
- `localStorage` : préférence d'interface comme le thème, lue sans attendre le daemon, sans toucher au contrat.

## Alternatives écartées
- `@angular/localize` (un build par langue, rechargement au changement) et un catalogue maison : choix de l'utilisateur.
- Langue dans les réglages du daemon : contrat à changer, démarrage qui attend le daemon.
- Un script `lang.js` avant Angular, comme `theme.js` : rien n'est peint avant le démarrage, l'initialiseur suffit.

## Conséquences
- Le chargement initial grossit du poids de Transloco (mesuré au build, sous le budget de 800 kB de la décision 036).
- Un nouveau texte d'une page traduite va dans les deux catalogues ; la parité le vérifie.
- Tant que tout n'est pas traduit, l'UI en anglais mélange les deux langues (Réglages en anglais, le reste en français) ; l'indication de la section Langue le dit.
- L'app Electron et un onglet de navigateur gardent chacun leur choix (stockage séparé, comme le thème).
