# ui/ — l'interface de Vigie

Application Angular 22 (signaux, sans zone.js), spartan/ui (`libs/ui`, alias `@spartan-ng/helm/*`), Tailwind v4, xterm.js.
Le daemon la sert sur 127.0.0.1 sous une CSP stricte (décision 044) ; elle ne parle qu'à lui, par HTTP et WebSocket, et ne charge
rien de l'extérieur. Règles du dépôt : `../CLAUDE.md` ; système visuel : `../DESIGN.md` ; décisions : `../decisions/`.

## Commandes

À lancer depuis la racine du dépôt (`npm install` uniquement à la racine : un seul lockfile).

- Tests : `npm test -w ui -- --no-watch`
- Lint : `npx eslint ui/src plugins` (ou `npm run lint` pour tout le dépôt)
- Build : `npm run build` ; dans le sandbox : `cd ui` puis `CI=1 npx ng build --progress=false`
- Dev : daemon lancé avec `VIGIE_DEV=1` (`VIGIE_DEV=1 npm start` à la racine, sinon il refuse l'origine `http://localhost:4200`), puis
  `npm start -w ui` (`ng serve` sur le port 4200, sans la CSP du daemon ; `proxy.conf.json` relaie `/api`, `/ws` et `/pty` vers 127.0.0.1:4317).

`prebuild`, `pretest` et `prestart` régénèrent `src/app/core/plugin-uis.generated.ts` (table des fronts de plugins, commitée).

## Build

- Budgets (`angular.json`) : chargement initial sous 800 kB (décision 036), 6 kB de CSS par composant.
- `optimization.styles.inlineCritical: false` : beasties (CSS critique) inline la feuille critique et charge le reste par
  `<link media="print" onload="this.media='all'">`, avec un script en ligne de repli. La CSP du daemon (décision 044, `script-src 'self'`)
  bloque le script et l'attribut `onload` : la feuille resterait en `media=print`, l'app sans styles. Après un build, `dist/ui/browser/index.html`
  ne doit contenir ni `<script>` en ligne ni attribut `on*=`.

## Arborescence

- `src/app/core/` : services singletons (`VigieService`, `AttentionService`, `ThemeService`, `LanguageService`, `ConfirmService`, `@Service()`, créés au
  démarrage par `provideAppInitializer` quand il le faut), types du contrat (`models.ts`, que des `z.infer`), aides pures partagées
  (`clipboard`, `format`, `markdown`, `platform`, `session-view`, `usage-rows`…) et mocks des specs (`*.mock.ts`).
- `src/app/shell/` : la coque, hors des pages — barre latérale, cloche et toasts, dialogue de confirmation, gabarit de page (`page/`),
  palette de recherche dans les sessions (`search-palette/`, ⌘F / Ctrl+F, chargée par `@defer` à l'ouverture ; décision 049).
- `src/app/features/` : une feature par page routée, un dossier par composant (décision 031), sous-composants rangés sous leur
  parent. Une aide utile à deux features remonte dans `core/`, pas d'import d'une feature vers une autre hors des exceptions de la 031.
  Les deux seules admises (un composant voisin réutilisé tel quel) : l'onglet Coût (`session/cost/`) dessine avec
  `usage/plot-chart/` et `usage/usage-charts.ts`, la page de session (`session/session-page/`) monte `terminal/terminal/`.
- `src/plugin-sdk/` : `@vigie/plugin-sdk`, seul pont entre le front d'un plugin (`../plugins/<id>/ui/`) et l'app (décision 037).
- `src/i18n/` : catalogues de traduction `fr.json` (source) et `en.json` (décision 048).
- `src/test-providers.ts` : providers communs à tous les specs (option `providersFile` du builder de tests) : Transloco avec les deux
  catalogues, français actif, clé absente = spec en échec.
- `public/` : fichiers servis tels quels (icône, manifeste, `theme.js` qui pose le thème avant Angular).

## Composant et ViewModel

- **Composant = vue** : gabarit, styles, `protected readonly vm = inject(XxxVm)`, câblage DOM seulement (`viewChild`, `afterNextRender`,
  écouteurs). Les inputs passent au VM par `vm.connect(...)` dans le constructeur.
- **ViewModel = logique** : `xxx.vm.ts` à côté, `@Injectable()` fourni par le composant (`providers: [XxxVm]`) — sauf `FilesSearchVm` et `FilesFinderVm`, fournis par
  `SessionFilesComponent` qui les partage avec ses panneaux —, état en `signal`,
  dérivés en `computed` / `linkedSignal`, E/S par `VigieService` ; `effect` seulement pour agir sur l'extérieur (réseau, DOM, stockage).
  Testé par `xxx.vm.spec.ts` (TestBed + mocks de `core/`), états d'erreur des ressources compris.
- **Sous-vue sans VM** acceptable quand elle n'est que de la présentation branchée sur le VM de son parent (elle l'injecte), sans E/S
  ni logique propre : les panneaux de la vue Fichiers sur `SessionFilesVm`, la barre latérale sur `AppVm`. Coque : la cloche, les toasts,
  une ligne d'attention et le dialogue de confirmation (`shell/notification-center`, `toast-host`, `attention-item`, `confirm-dialog`)
  n'ont pas de VM et lisent directement leur singleton de `core/` (`AttentionService`, `ConfirmService`), qui porte la logique et les E/S.

## Langues (décision 048)

- Transloco, français (langue source) et anglais. Pages traduites : **Réglages**. Les autres restent en dur en français ; la liste de
  ce qui reste est le `ponytail:` de `core/language.service.ts`, et les formats (`core/format.ts`) restent en `fr-FR`.
- Catalogues `src/i18n/{fr,en}.json`, chargés par `import()` (un chunk par langue, hors chargement initial). JSON imbriqué : premier
  niveau = la feature (`settings`…), clés camelCase anglais qui disent le rôle, jamais le texte. Valeurs en texte brut avec
  `{{ param }}`, jamais de HTML (décision 044) : un morceau mis en forme coupe la phrase en `xxxBefore` / `xxxAfter`, espaces de jonction
  dans les valeurs. Pas de clé commune pour un mot qui s'accorde. Français au tutoiement.
- Gabarit : `*transloco="let t; prefix: '<feature>'"` sur la racine de la page, puis `t('cle')`. VM : `TranslocoService.translate(...)`
  au moment du message (jamais une chaîne traduite gardée d'avance).
- Langue : `LanguageService` (`lang`, `set`) ; préférence `localStorage` `vigie-lang`, sinon la langue du système (`fr*` → français,
  sinon anglais) ; `<html lang>` suit. L'initialiseur de l'app attend le catalogue actif (pas de clé à l'écran au premier rendu).
- Specs : français actif ; une clé absente fait échouer le spec ; `language.service.spec.ts` vérifie que les deux catalogues ont les
  mêmes clés et les mêmes paramètres.
