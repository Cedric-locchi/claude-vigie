# Écrire un plugin

Un plugin ajoute un onglet à une session : il détecte s'il s'applique au dossier du projet, lit des données par un outil
(méthodes) et ouvre des terminaux (actions). Décisions 034 (système), 037 (front en Angular), 038 (npm et nx). Les plugins
livrés (`mise`, `xcode`, `npm`, `nx`) sont les exemples de référence ; ci-dessous, des extraits de `plugins/mise/`.

## Fichiers

    plugins/<id>/
      package.json     manifeste : champ `vigie`
      index.mjs        back, chargé par le daemon (daemon/plugins.mjs)
      contract.mjs     schémas zod/mini, partagés par le back et le front
      index.test.mjs   tests du back (node:test, testPlugin)
      ui/index.ts      front : composant Angular exporté par défaut, compilé avec l'app

`<id>` : `^[a-z0-9][a-z0-9-]{0,39}$`, identique au nom du dossier et à `vigie.id`.

```json
{ "name": "@vigie/plugin-mise", "private": true, "type": "module", "main": "index.mjs",
  "vigie": { "api": 2, "id": "mise", "name": "Tâches mise", "description": "Lance les tâches mise du projet dans un terminal." } }
```

Une `api` autre que celle du daemon (`API = 2`) ou un `id` différent du dossier : le plugin est listé avec son erreur et ne peut pas être activé.

## Back : `index.mjs`

Export par défaut : une fabrique qui reçoit le SDK (`vigie`) et renvoie `vigie.definePlugin(…)`. Le back n'importe rien de
Vigie : seulement `node:*` (sauf `child_process`, `node:module` et les modules réseau `http`, `https`, `http2`, `net`, `tls`, `dgram`, `dns`,
`dns/promises`), son `./contract.mjs` et ses propres fichiers `./….js` / `.mjs`, par des imports statiques, sans `fetch`, `WebSocket` ni `EventSource`, sans lire la plateforme.

```js
import { MiseRunParams, MiseTasks } from './contract.mjs';

export default (vigie) => vigie.definePlugin({
  id: 'mise',
  session: {
    // Rapide et sans process : il tourne pour chaque session à chaque ouverture (3 s max, sinon compté absent).
    detect: ({ cwd }) => hasProjectTasks(cwd),            // true, false, ou { badge: '3' }
    methods: {
      // JSON lu par le front ; `result` vérifie la réponse avant qu'elle parte (500 sinon).
      tasks: { result: MiseTasks, timeout: 10_000, handler: ({ cwd, signal }) => listTasks(vigie, cwd, signal) },
    },
    actions: {
      run: {
        params: MiseRunParams,                             // sans `params`, le handler reçoit {} : rien de l'UI n'arrive sans être décrit
        async handler({ cwd, params, signal }) {
          const t = (await listTasks(vigie, cwd, signal)).tasks.find((x) => x.name === params.task);
          if (!t || t.name.startsWith('-')) throw vigie.error('Tâche mise inconnue'); // 400, message affiché tel quel
          return vigie.terminal(['mise', 'run', t.name], { title: t.name });         // un argv, jamais une chaîne de shell
        },
      },
    },
  },
});
```

SDK (`createSdk`, `daemon/plugins.mjs`) :

| | |
|---|---|
| `definePlugin(def)` | Vérifie la forme au chargement : `detect` obligatoire, méthodes et actions avec `handler`, `params` / `result` = schémas zod, un même nom jamais méthode et action. |
| `exec(argv, { cwd, timeout, env, signal, maxBuffer })` | Lance un programme **sans shell**, stdin fermé, dans un groupe tué au délai, au `signal`, au-delà de `maxBuffer` (8 Mo) et à l'arrêt du daemon. Ne rejette jamais : `{ ok, code, stdout, stderr, missing, timedOut, error }`. `missing` : outil absent (c'est ainsi qu'on sait s'il est disponible, jamais par `process.platform`). `env` : surcharges, `null` retire la variable. Passe toujours le `signal` reçu par le handler. |
| `terminal(argv, { title })` | Décrit un terminal ; le daemon quote chaque argument et seul le transport ouvre le PTY. Refusé : argv vide ou > 64, argument > 8 000 caractères, octet nul, antislash, programme en `-…`. |
| `error(message)` | Erreur montrée à l'utilisateur (400). Toute autre exception devient un 500 générique, journalisé. |
| `z` | `zod/mini`. |
| `dataDir` | `~/.vigie/plugins-data/<id>/`, seul endroit où un plugin écrit. |

Délais : `detect` 3 s ; méthode 10 s par défaut, `timeout` propre de 1 à 60 000 ms (hors de cette plage, ou sur une action :
plugin refusé au chargement) ; délai dépassé : 504 ; action 10 s, sans `timeout` (elle ne fait que décrire un terminal). Requête abandonnée (onglet fermé) : le `signal` du handler est annulé, `exec` tue l'outil.
Réponse d'une méthode : 4 Mo de JSON au plus.

## Schémas : `contract.mjs`

`import * as z from 'zod/mini'` et rien d'autre : le fichier est aussi compilé dans le bundle de l'UI.

```js
import * as z from 'zod/mini';
export const MiseTasks = z.object({ available: z.boolean(), untrusted: z.boolean(), tasks: z.array(MiseTask), error: z.nullable(z.string()) });
export const MiseRunParams = z.object({ task: z.string({ error: 'Tâche mise inconnue' }) });
```

Chaque méthode d'un plugin livré déclare son `result`. Les types du front en dérivent (`z.infer`), jamais écrits à la main.

## Front : `ui/index.ts`

Composant Angular exporté par défaut, avec un input `sessionId`. Il n'importe que `@vigie/plugin-sdk` (+ `@vigie/plugin-sdk/testing` et
`vitest` dans les specs), `@angular/*`, `@spartan-ng/helm/*`, `zod/mini`, `../contract.mjs` et ses propres fichiers `./…` (sans `..`) :
liste d'autorisés vérifiée par ESLint, tout autre import est refusé, `@ng-icons/*` compris (les composants spartan apportent leurs icônes).

Il parle à son back par `PluginHost` (injecté), jamais par `HttpClient` :

- `call(method, params, schema, { signal })` : appelle une méthode ; **`schema` est obligatoire**, la réponse est validée
  (hors contrat → `Error(OUTDATED)`, « le daemon est-il à jour ? »). Dans un `resource`, passe l'`abortSignal` du loader.
- `terminal(action, params)` : lance une action ; la page affiche le terminal ouvert.
- `refresh()` : relit les onglets de la session (détection, badge), par exemple après `mise trust`.
- `launcher()` : lancements un à la fois, à créer dans le VM. `run(id, fn, fallback)` est ignoré si un lancement est en cours ;
  `launching()` porte l'id en cours (boutons inactifs), `error()` le dernier échec (message du host, sinon `fallback`).
- `errorMessage(e, fallback)` : message de l'erreur rendue par le host, déjà lisible (message du daemon, « le daemon ne répond
  pas » s'il est injoignable, « Réponse inattendue du daemon : est-il à jour ? » hors contrat), sinon `fallback`.
- Le lanceur de tâches partagé (`TaskLauncherComponent`, utilisé par mise, npm et nx) ; voir `ui/src/plugin-sdk/index.ts`.

```ts
private readonly host = inject(PluginHost);
private readonly res = resource({
  params: () => ({ id: this.host.sessionId(), cwd: this.host.cwd() }),
  loader: ({ abortSignal }) => this.host.call('tasks', {}, MiseTasksSchema, { signal: abortSignal }),
});
```

Textes : en dur, en français, pour l'instant ; la traduction d'un plugin passera par le SDK (décision 048), jamais par un import direct de
`@jsverse/transloco`.

Le texte d'un outil reste du texte : interpolation `{{ }}`, jamais `innerHTML`, `[innerHTML]`, `DomSanitizer` ni `bypassSecurityTrust*`.

Table des fronts : `node scripts/plugin-uis.mjs` écrit `ui/src/app/core/plugin-uis.generated.ts` (un import paresseux par plugin
qui a un `ui/index.ts`). Commite-la ; `npm test` commence par `--check`, qui échoue si elle est périmée.

## Règles vérifiées par ESLint

`eslint.config.mjs` refuse les formes usuelles de ce qui suit ; un contournement délibéré (valeur passée par une variable,
`Reflect.get`…) n'est pas vu et reste à la relecture.

- back (`plugins/<id>/**/*.{js,mjs}`, hors `ui/`, `contract.mjs` et tests) : tout import autre que `node:*` et ses propres fichiers
  `./….js` / `.mjs` (sans `..` : ni `daemon/`, ni `contract/`, ni `@vigie/contract`, ni `ui/src/`, ni un autre plugin, ni un paquet npm
  comme `cross-spawn` ou `undici`, ni un `./x.cjs`, ni un fichier de son `ui/`) ; parmi `node:*`, `child_process`, `http` / `https` / `net` / `tls` / `dgram` /
  `http2` / `dns` / `dns/promises` et `node:module` ; toute plateforme lue (`process.platform`, `os.platform()`, `os.type()`,
  `x['platform']`, `const { platform } = …`, imports nommés de `node:os` / `node:process`) ; `fetch` / `WebSocket` / `EventSource`
  (par leur nom ou par `globalThis`) ; `import()` dynamique et `getBuiltinModule` ;
- `contract.mjs` : tout import autre que `zod/mini`, `import()` dynamique, plateforme lue ;
- front (`plugins/*/ui/**`) : tout import hors de la liste d'autorisés, donc l'app, le daemon, le contrat de Vigie, un autre plugin,
  `marked` et un fichier JS voisin (`./x.mjs`) ; en plus `@angular/common/http`, `DomSanitizer`, `bypassSecurityTrust*` ; le HTML de
  confiance : `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`, `createContextualFragment` (sur tout objet,
  `x['innerHTML']` compris), `{ innerHTML: … }`, la chaîne `'innerHTML'` / `'[innerHTML]'` (`host`, `@HostBinding`, `setProperty`) et
  `[innerHTML]` en gabarit, casse ignorée ; le réseau direct : `fetch`, `sendBeacon`, `WebSocket`, `EventSource`, `XMLHttpRequest`,
  `Worker`, `SharedWorker` (par leur nom, comme propriété de n'importe quel objet ou déstructurés) ; la navigation : `open` et
  `location` (seuls ou sur `window`, `self`, `globalThis`, `document`) ; `import()` dynamique ;
- partout, tests compris : `zod` hors `zod/mini` (import statique et `import()`) ; `require()` (le code est en ESM : `require` n'y
  est pas défini).

Un module dans un sous-dossier du back n'a accès qu'à `node:*` et à ses voisins `./…` (pas à `../contract.mjs`) : garde à la racine
du plugin les modules qui importent son contrat.

Non vérifiables par le lint, à respecter : écrire seulement sous `vigie.dataDir` ; passer le `signal` à `exec` dans `detect` et les
méthodes ; ne jamais lancer dans `detect` un outil qui exécute le code du dépôt.

## Tests

`index.test.mjs` passe par `testPlugin` (même runner, mêmes validations que le daemon) ; `bins` remplace un outil par un faux
exécutable, sans dépendre de la machine :

```js
import { tempDir, testPlugin } from '../../daemon/plugins.mjs';
import plugin from './index.mjs';
const p = testPlugin(plugin, { bins: { mise: fauxMise } });
assert.deepEqual(await p.call(cwd, 'tasks', {}), { available: true, untrusted: false, tasks: [], error: null });
```

Le front a ses specs (`*.spec.ts`, `fakePluginHost` de `@vigie/plugin-sdk/testing`). Tout : `npm test`.

## Activation

Désactivé par défaut. On l'active sur la page Plugins de l'app (`POST /api/plugins/:id`, état écrit dans `~/.vigie/settings.json`).
Un plugin désactivé n'est jamais importé ; activé, il est importé au démarrage du daemon, et s'il ne se charge pas, son erreur
s'affiche sur sa carte. Après une modification du back, redémarre le daemon (`import()` garde le module en cache).
