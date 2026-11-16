# 031 — Arborescence de l'UI : un dossier par composant

- **Statut :** Acceptée
- **Date :** 2026-11-16
- **Décidé par :** Toi

## Contexte
`ui/src/app/features/session/` comptait près de 70 fichiers à plat : composants de la page, de l'onglet Fichiers, de la Timeline, leurs ViewModels, leurs specs et leurs fonctions pures, mêlés par ordre alphabétique. Retrouver tout ce qui fait un composant demandait de deviner les préfixes (`files-*`, `config-*`, `gantt`…).

## Décision
- **Un dossier par composant**, qui contient son `.component.ts`, son `.vm.ts`, leurs specs et ses fonctions pures dédiées (ex. `timeline/` : `timeline.component.ts`, `timeline.vm.ts`, `timeline.ts` et leurs specs).
- **Les sous-composants sont rangés sous leur parent** (`session/files/search/`, `session/timeline/gantt/`, `session/config/permissions/`).
- **Un helper pur partagé** par plusieurs composants d'une feature monte au niveau commun le plus proche (`usage/usage-series.ts`, `usage/usage-charts.ts` ; `session/config/config-rules.ts`).
- Les noms de fichiers ne changent pas (`session-files.vm.ts` reste `session-files.vm.ts` dans `session/files/`) : le dossier range, le nom identifie.

## Exceptions
- **Feature à un seul composant de page** (`new-session/`, `settings/`) : reste à plat dans son dossier de feature, un sous-dossier n'apporterait rien.
- `core/` (services singletons, helpers transverses) et `shell/` : hors de cette règle.
- Un composant peut importer le ViewModel ou un helper d'un composant voisin quand il en a réellement besoin (ex. `session-files.vm.ts` réutilise `STATUS` et `message` de `diff/session-diff.vm.ts`, l'onglet Coût réutilise `usage/plot-chart/`) : on ne déplace pas du code juste pour l'arborescence.

## Raisons
- Retrouver ensemble un composant, son ViewModel et ses tests : un dossier ouvert = tout ce qu'il faut lire ou modifier.
- L'arbre des dossiers reflète l'arbre des composants : on voit tout de suite ce qui appartient à l'onglet Fichiers ou à la Timeline.

## Alternatives écartées
- Rester à plat avec des préfixes : ne tient plus au-delà de quelques dizaines de fichiers.
- Un dossier par type (`components/`, `vms/`, `specs/`) : sépare ce qu'on modifie ensemble.
- Fichiers `index.ts` de réexport : un niveau d'indirection de plus pour des imports relatifs courts.

## Conséquences
- Les imports relatifs sont plus longs (`../../../core/…`) ; un déplacement se fait par `git mv` et mise à jour des imports, vérifiée par `tsc -p tsconfig.app.json` et `tsconfig.spec.json`.
- Un nouveau composant crée son dossier, à côté de son parent.
