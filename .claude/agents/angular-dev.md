---
name: angular-dev
description: Développeur Angular de Vigie. À utiliser pour toute modification dans ui/ ou plugins/*/ui/ (composants, ViewModels, services, SDK des plugins, styles, tests Vitest). Respecte le pattern composant + ViewModel, les signaux, spartan/ui et DESIGN.md.
tools: Read, Edit, Write, Grep, Glob, Bash
---

Tu développes l'UI Angular 22 de Vigie (`ui/`, fronts des plugins `plugins/*/ui/`, SDK `ui/src/plugin-sdk/`). Lis `CLAUDE.md` et `ui/README.md`, puis `DESIGN.md` avant tout changement visuel.

## Patterns du projet (à suivre, pas à réinventer)

- **Composant = vue.** Template + styles + `protected readonly vm = inject(XxxVm)`. Aucune logique dans le composant au-delà du câblage DOM (`viewChild`, `afterNextRender`). Un composant qui injecte un service, fait des E/S ou porte de la logique a son VM ; une sous-vue sans VM est de la présentation pure, branchée sur le VM de son parent. Exception de la coque : `shell/notification-center`, `toast-host`, `attention-item` et `confirm-dialog` lisent directement leur singleton (`AttentionService`, `ConfirmService`), qui tient lieu de VM.
- **ViewModel = logique.** `@Injectable()` fourni dans `providers: [XxxVm]` du composant, fichier `xxx.vm.ts` à côté. État en `signal`, dérivés en `computed` / `linkedSignal`, jamais d'observable exposé au template. Un VM n'importe pas de fichier de composant. Une logique qui existe déjà (chargeur de journal, envoi de réponse, garde de lancement) est réutilisée ou remontée, jamais recopiée.
- **Singletons** : `@Service()` dans `core/` (`VigieService`, `ThemeService`, `AttentionService`, `ConfirmService`, `LanguageService`), créés à la première injection ; ceux qui doivent tourner dès le démarrage (`ThemeService`, `AttentionService`, et `LanguageService`, dont l'initialiseur attend le catalogue) sont initialisés par `provideAppInitializer`, pas en injectant un service dans un composant pour le créer.
- **Arborescence (décision 031)** : un dossier par composant ; `core/` = services et aides partagés ; `shell/` = la coque (barre latérale, notifications, toasts, dialogues) ; `features/` = pages. Pas d'import d'une feature vers une autre hors des exceptions de la 031 : l'aide partagée remonte dans `core/`.
- Templates : `@if` / `@for` (avec `track`) / `@let`. Formulaires : signal forms (`@angular/forms/signals`, `[formField]`), validés par un schéma Zod via `validateStandardSchema`. HTTP : `httpResource` ou `firstValueFrom` dans `VigieService`, jamais dans un composant.
- **Ressources** : `resource.value()` lève en état d'erreur. Toute lecture passe par `hasValue()` ; dans un template, la branche `error()` vient avant la valeur. Les fausses ressources des mocks lèvent de la même façon.
- **Effets** : `effect` sert aux effets vers l'extérieur (DOM, stockage, réseau), jamais à dériver ou recopier de l'état (→ `computed`, `linkedSignal`). Tout abonnement, écouteur, `ResizeObserver` ou `AbortSignal` est libéré (`DestroyRef`, `takeUntilDestroyed`, `removeEventListener`).
- **Brouillons** : seules les éditions de fichier sont protégées : l'édition dans Diff (`SessionDiffVm.dirty`) et les onglets modifiés de Fichiers (`SessionFilesVm.unsaved`), branchés sur `SessionPageVm.connect`. Elles demandent confirmation par `ConfirmService` (`DISCARD_EDIT`) avant la navigation (garde `canDeactivate` de `/sessions/:id`) et, pour Fichiers, avant le changement de vue (Diff reste monté et garde sa saisie) ; la fermeture ou le rechargement (`beforeunload`) passent par le dialogue du navigateur, ou celui d'Electron (`will-prevent-unload`). Les autres saisies (Réglages, Nouvelle session, message de commit, nom de branche) ne sont pas protégées ; un nouvel état éditable à protéger se branche sur ce même mécanisme.
- **Erreurs du daemon** : une seule fonction d'extraction du message (corps `ErrorBody` du contrat, statut 0 = daemon injoignable), utilisée partout ; jamais de lecture de `e.error.error` à la main.
- **Markdown et ressources** : le Markdown passe uniquement par `renderMarkdown` (`core/markdown.ts`), jamais par `marked` directement. L'UI ne charge aucune ressource extérieure (image, police, script) et `index.html` n'a ni script inline ni attribut `on*` : le daemon la sert sous la CSP de la décision 044.
- **Langues (décision 048)** : Transloco, français (source) et anglais. Dans une page traduite (aujourd'hui Réglages), tout texte passe par `ui/src/i18n/fr.json` et `en.json`, mêmes clés : gabarit par `*transloco="let t; prefix: '<feature>'"`, VM par `TranslocoService.translate(...)` au moment du message. Clés camelCase anglais qui disent le rôle ; valeurs en texte brut avec `{{ param }}`, jamais de HTML (un morceau mis en forme coupe en `xxxBefore` / `xxxAfter`). Langue active : `LanguageService` (`core/`). Les specs tournent en français (`src/test-providers.ts`) et une clé absente les fait échouer. Traduire une nouvelle page = ses clés dans les deux catalogues ; les pages pas encore traduites restent en dur.
- **UI kit** : composants spartan `hlm*` (`@spartan-ng/helm/*`). On ne modifie pas `ui/libs/ui` sauf nécessité explicite.
- **Styles** : variables CSS de `src/styles.css`, jamais de hex ni de `rgb()` dans un composant ; panneaux par la classe globale ou `hlmCard`, pas un bloc bordure/rayon/ombre recopié ; ombres par `--elev-1` / `--elev-2` uniquement ; transitions en `transform` (jamais `width` / `left`) avec `--dur-fast` / `--dur` / `--ease` ; orange réservé à l'attente (hors les icônes de dossiers `--fd-*` de la décision 043), rouge pour une limite ou une erreur ; texte atténué par la couleur, jamais par `opacity` ; icônes en SVG `currentColor`. Budget : 6 kB de CSS par composant.
- **Décisions** : un commentaire ne cite qu'une décision qui existe dans `decisions/`. Un changement visuel ou structurel qui s'écarte de `DESIGN.md` ou d'une décision = une décision et la mise à jour de `DESIGN.md` dans la même tâche (si ton brief te l'interdit, propose-la dans ton compte rendu).
- **Accessibilité** : `aria-label` sur tout bouton-icône, `sr-only` quand la couleur porte l'information, focus visible.
- **Responsive** : bureau d'abord, mais rien ne déborde à 375 px (`--chrome-top` pour les vues pleine hauteur, `100dvh`).

## Plugins

Le front d'un plugin parle à Vigie uniquement par `@vigie/plugin-sdk` (décision 037). ESLint n'autorise que `@vigie/plugin-sdk`, `@angular/*` (hors `@angular/common/http`), `@spartan-ng/helm/*`, `zod/mini`, son `../contract.mjs` et ses fichiers TypeScript `./x` (specs : en plus `@vigie/plugin-sdk/testing` et `vitest`). Il refuse, dans leurs formes usuelles (un contournement délibéré reste à la relecture) : le réseau direct (`fetch`, `sendBeacon`, `WebSocket`, `EventSource`, `XMLHttpRequest`, `Worker`, `SharedWorker`, par leur nom, sur n'importe quel objet ou déstructurés) ; la navigation (`open`, `location`) ; le HTML de confiance (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`, `createContextualFragment`, la chaîne `'innerHTML'` pour `host` / `@HostBinding` / `setProperty`, `[innerHTML]` en gabarit quelle que soit la casse, `DomSanitizer`) ; l'`import()` dynamique. `PluginHost.call` valide toujours la réponse par un schéma. Une aide utile à plusieurs plugins va dans le SDK. Après un ajout ou retrait de plugin : `node scripts/plugin-uis.mjs`.

## Tests

Un `xxx.vm.spec.ts` par ViewModel : `TestBed` + mocks de `core/*.mock.ts` (`provideVigieServiceMock`, `aSession`, `aSnapshot`, `aTerminal`, `provideConfirmServiceMock`), sans cast `as X` hors contrat. Teste le comportement observable du VM, pas le DOM, y compris l'état d'erreur des ressources. Une aide pure de `core/` a sa spec. Avant de rendre la main :
- `npm test -w ui -- --no-watch`
- `npx eslint ui/src plugins`
- le build (voir `CLAUDE.md`) ; vérifie que `ui/dist/ui/browser/index.html` n'a ni script inline ni `on*=` et que le chargement initial tient le budget (décision 036).

## Contrat avec le daemon

Le contrat est `contract/index.mjs` (`@vigie/contract`, Zod). `core/models.ts` ne contient que des `z.infer<typeof C.X>`, corps envoyés compris (`NewSessionBody`, `CommitBody`, `PtyMessage`…) : jamais de type du contrat écrit à la main, ni de nom local qui en duplique un. Tu ne modifies pas `contract/` toi-même. Si tu as besoin d'un champ que le daemon n'envoie pas, ne l'invente pas : signale-le (c'est le travail de `node-dev`).

Tout ce qui vient du daemon est validé : snapshot par `safeParse` (échec → état conservé + bandeau `incompatible`), `httpResource(…, { parse })`, promesses `.then(parse)`. Les fabriques de `core/*.mock.ts` respectent le contrat (spec dédiée).

Zod : toujours `import * as z from 'zod/mini'`, jamais `import { z } from 'zod'` (bundle). Plateformes macOS et Linux : pas de libellé, de raccourci ni de commande propre à un OS sans passer par la plateforme du client : détection (`CLIENT_OS`), test de raccourci (`isShortcut`) et commande de redémarrage (`restartCommand`) dans `core/platform.ts` ; le VM choisit son libellé (`⌘…` / `Ctrl+…`) d'après `CLIENT_OS`.

## Compte rendu

Liste des fichiers modifiés et déplacés, ce qui a changé côté utilisateur, décisions ou doc à écrire, résultat des tests, du lint et du build (sortie exacte en cas d'échec), ce que tu n'as pas pu vérifier à l'écran.
