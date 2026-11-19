# 034 — Système de plugins : de nouveaux onglets de session

- **Statut :** Acceptée (point des alias remplacé par 035 : anciennes routes retirées directement ; points 1 et 3, vue déclarative, remplacés par 037)
- **Date :** 2026-11-18
- **Décidé par :** Toi (plugins locaux livrés avec l'app, un clic les active, désactivés par défaut ; onglets de session uniquement)

## Contexte
mise (`daemon/mise.mjs`) et Xcode (`daemon/xcode.mjs`, décision 030) sont des intégrations propres à un outil, codées en dur à chaque étage :
- daemon : un adaptateur, des routes dédiées dans `transport.mjs` (`/mise`, `/xcode`, `/xcode/targets`, `/xcode/open`), des branches `miseTask` / `miseTrust` / `xcode` / `script` dans `POST …/terminals` ;
- contrat : `MiseTasks`, `XcodeProject`, `XcodeTargets`, `XcodeBody`… dans `contract/index.mjs` ;
- UI : un composant et un ViewModel par intégration, plus `hasMise` / `hasXcode` et `SessionView` dans `session-page`, plus le mock.

Chaque nouvel outil (Gradle, Docker, Cargo, Make…) toucherait les mêmes six endroits, et tout le monde embarque des intégrations dont il n'a pas besoin. On veut des plugins qu'on installe à la demande, et un SDK pour en écrire facilement.

Un seul point d'extension : **l'onglet de session**, un onglet de plus dans la vue d'une session, affiché seulement si le plugin s'applique au projet (mise, Xcode).

## Décision

### 1. Le plugin vit dans le daemon, l'UI ne lance jamais son code
Un plugin est un module ESM chargé par le daemon. Il ne livre **aucun JavaScript à l'UI** : il renvoie une **vue déclarative** (un arbre de nœuds JSON) que l'UI Angular dessine avec ses propres composants spartan.

Pourquoi :
- l'UI garde sa CSP, son budget de bundle et DESIGN.md : un plugin ne peut ni casser le style, ni lire le DOM, ni contourner le contrôle d'origine ;
- pas de chargement dynamique de composants Angular (module federation, web components, iframes), qui serait lourd et fragile ;
- tout ce que l'UI reçoit reste validé par Zod (`safeParse`), comme aujourd'hui.

mise et Xcode tiennent dans ce modèle : « détecter → lister → proposer des actions qui lancent une commande dans un terminal ».

### 2. Forme d'un plugin (SDK)
Le module exporte par défaut une fonction qui reçoit le SDK. Le plugin n'importe donc rien de Vigie : pas de copie de zod en double, pas de lien de workspace à embarquer (electron-builder ne les copie pas).

```js
// plugins/mise/index.mjs
export default (vigie) => vigie.definePlugin({
  id: 'mise',
  name: 'Tâches mise',

  session: {                                   // onglet de session (facultatif)
    async detect({ cwd }) {                     // l'onglet n'existe que si vrai ; doit être rapide
      return (await list(vigie, cwd)).available;
    },
    async view({ cwd }) {                       // contenu de l'onglet
      const r = await list(vigie, cwd);
      const { ui } = vigie;
      return [
        r.untrusted && ui.banner('warn', 'Config mise non approuvée', ui.button('Approuver', { action: 'trust' })),
        ui.list(r.tasks.map((t) => ui.item({ title: t.name, subtitle: t.description, meta: t.source,
          action: ui.button('Lancer', { action: 'run', params: { task: t.name } }) }))),
      ];
    },
    actions: {
      run: {
        params: vigie.z.object({ task: vigie.z.string() }),   // validé par le daemon avant l'appel
        async handler({ cwd, params }) {
          const t = (await list(vigie, cwd)).tasks.find((x) => x.name === params.task);
          if (!t) throw vigie.error('Tâche mise inconnue');   // relu, pas cru sur parole
          return vigie.terminal(['mise', 'run', t.name], { title: t.name });
        },
      },
      trust: { handler: () => vigie.terminal(['mise', 'trust'], { title: 'mise trust' }) },
    },
  },
});

const list = (vigie, cwd) => vigie.exec(['mise', 'tasks', 'ls', '--json'], { cwd, timeout: 5000 }).then(parse);
```

Ce que le SDK fournit (et rien d'autre) :
- `definePlugin` : vérifie la forme au chargement ;
- `z` : le `zod/mini` du daemon ;
- `exec(argv, { cwd, timeout, env })` : `execFile` sans shell, stdin fermé, `cleanEnv`, groupe de process tué au timeout, **ne rejette jamais** (`{ ok, code, stdout, stderr, missing }`) : c'est le patron actuel de `mise.mjs` et `xcode.mjs`, écrit une fois ;
- `terminal(argv, { title })` : ouvre un terminal Vigie dans la session, avec chaque argument passé par `shQuote` ; le plugin ne fournit jamais une chaîne de shell ;
- `ui.*` : constructeurs de nœuds de vue ;
- `error(message)` : erreur montrée telle quelle à l'utilisateur (400) ;
- `dataDir` : `~/.vigie/plugins-data/<id>/`, seul endroit où le plugin écrit (le DerivedData de Xcode s'y place) ;
- `testPlugin(plugin, { cwd, bins })` : harnais de test (`node:test`) qui appelle `detect`, `view` et les actions avec de faux exécutables, et vérifie chaque vue contre le contrat (l'équivalent de `conforme`).

Les types (`.d.ts`) sont publiés à part pour l'autocomplétion, en devDependency seulement.

### 3. Vue déclarative : une petite grammaire fermée
Nœuds, dans `contract/index.mjs` (`PluginNode`) : `text`, `banner` (info / warn / err), `list` + `item`, `select` (nommé, options plates ou groupées), `button` (action + params), `row` (alignement horizontal), `lazy` (section chargée à part, pour ce qui est lent comme `xcodebuild -list`). Tailles bornées : 500 nœuds, textes de 2 000 caractères.

Les `select` d'une vue sont l'état du formulaire : un clic sur un bouton envoie `{ params, values }`, où `values` contient les valeurs courantes des `select`. C'est ainsi que Xcode transmet le scheme et le simulateur choisis.

**Évolution sans rupture** : une UI qui reçoit un type de nœud qu'elle ne connaît pas affiche « Mets Vigie à jour pour voir cet élément » à sa place, au lieu de rejeter toute la vue. Ajouter un type de nœud reste donc additif (mineur), contrairement à la règle actuelle sur les enums du snapshot.

### 4. Routes génériques (toutes avec contrôle d'origine, même en GET : un plugin peut lancer un outil)
- `GET  /api/sessions/:id/plugins` → `[{ id, name, badge? }]` : plugins dont `detect` est vrai. Remplace `hasMise` / `hasXcode`. Délai de 3 s par plugin : passé ce délai, le plugin est compté absent.
- `GET  /api/sessions/:id/plugins/:pid[?section=…]` → vue de l'onglet (ou d'une section `lazy`).
- `POST /api/sessions/:id/plugins/:pid/actions/:aid` `{ params, values }` → terminal ouvert (201), nouvelle vue, ou `{ error }`.

Le daemon applique lui-même : hôte, origine, `content-type`, schéma `params` du plugin, plafond de taille, try autour de chaque appel (un plugin qui lève ne fait pas tomber le daemon), délai maximal par appel (10 s, 60 s pour `lazy`).

### 5. Page Plugins : les plugins sont locaux, un clic les active
Pour l'instant, tout est local : **les plugins sont livrés avec Vigie** (`plugins/<id>/` dans le dépôt, embarqués dans l'app). Rien ne se télécharge, aucun réseau.

Nouvelle entrée **Plugins** dans le pied de la barre latérale, à côté de Discussion et Réglages (route `/plugins`). La page montre une carte par plugin : nom, description, et son état. **Un clic sur la carte active le plugin** ; un second clic le désactive. L'effet est immédiat : le daemon pousse un snapshot, l'UI relit la liste des onglets, sans redémarrage. Un plugin qui n'a pas pu se charger (API non supportée, erreur à l'import) l'indique sur sa carte.

- **Désactivés par défaut** : on active ce dont on a besoin.
- Un plugin désactivé n'est **jamais importé** : son code ne tourne pas. À la première activation, le daemon fait l'`import()` du module ; à la désactivation, il cesse de l'appeler. Le module reste en mémoire jusqu'au redémarrage (`ponytail:` sans effet tant que le code ne change pas pendant que le daemon tourne).
- L'état est dans `~/.vigie/settings.json` (`plugins: { mise: true }`). Liste des plugins : lecture de `plugins/*/package.json` au démarrage (`"vigie": { "api": 1, "id": "…", "name": "…", "description": "…" }`).
- `api` : version de l'API du SDK ; un plugin dont l'`api` n'est pas supportée ne peut pas être activé.

Routes (POST : origine, `content-type` et schéma du contrat, comme les autres) :
- `GET /api/plugins` → `[{ id, name, description, enabled, error }]` ;
- `POST /api/plugins/:id` `{ enabled }`.

### 6. Modèle de confiance
Un plugin tourne dans le process du daemon, avec tes droits. Tant que seuls les plugins du dépôt existent, c'est du code de Vigie, relu comme le reste : les règles du projet (aucune requête sortante, `~/.claude` en lecture seule, `execFile` sans shell) s'appliquent à chaque plugin, et un plugin est revu comme un module du daemon.

Le système garantit en plus : l'UI n'exécute jamais de code de plugin, toute entrée est validée par le daemon avant d'atteindre le plugin, les commandes passent par `argv` + `shQuote`, et les routes ont le même contrôle d'hôte et d'origine que le reste.

## Plan en trois étapes (chacune livrable seule)
1. **Interne** (mineur, puis **majeur** au retrait des anciennes routes) : contrat `PluginNode`, routes génériques, chargeur des plugins du dépôt, un composant UI `plugin-view` qui dessine l'arbre ; mise porté en premier, puis Xcode. On supprime `mise.mjs` / `xcode.mjs` du daemon, leurs routes, leurs schémas et les deux composants UI. Les anciennes routes restent un temps comme alias, puisque le daemon peut tourner en service séparé de l'UI.
2. **Page Plugins** : page `/plugins` (un clic active ou désactive, sans redémarrer), plugins désactivés par défaut, SDK documenté (`docs/plugins.md`) avec `testPlugin` et un exemple minimal.
3. **Plus tard, seulement si un besoin réel apparaît** : plugins tiers (installation depuis un dossier, puis catalogue distant : exception réseau à décider à part, avec empreinte sha256 et sans `postinstall`, et confirmation « code non vérifié »), isolation par process enfant (`fork` + modèle de permissions de Node, IPC), autres points d'extension (widgets du tableau de bord, type de projet du sélecteur, réaction aux changements d'état d'une session, badge dans la barre latérale), rechargement à chaud.

## Raisons
- L'étape 1 est rentable même sans plugin tiers : le prochain outil coûte un dossier au lieu de six fichiers modifiés, et environ 700 lignes d'UI propres à mise et Xcode disparaissent au profit d'un seul moteur de rendu.
- Une vue déclarative garde intactes les règles qui font Vigie : local, contrôle d'origine, contrat Zod, design unique.
- Un seul point d'extension pour commencer : la grammaire de vue et le SDK pourront servir à d'autres (widgets du tableau de bord) sans changer de modèle.

## Alternatives écartées
- **Composants Angular chargés dynamiquement / web components / iframes** : liberté totale d'interface, mais code tiers dans l'UI, style incontrôlable, budget de bundle cassé, et Angular à recompiler par plugin.
- **Plugins en process séparés dès le départ** : isolation réelle, mais mise et Xcode doivent de toute façon lancer des process, ce qui vide en grande partie le modèle de permissions. Coût élevé pour un gain faible tant que tous les plugins sont les nôtres. Gardé pour l'étape 3.
- **Rester en dur et ajouter les intégrations au fil de l'eau** : simple, mais chaque outil alourdit l'app de tout le monde et touche le contrat.
- **Réutiliser le système de plugins de Claude Code** : il étend Claude, pas l'interface de Vigie.

## Conséquences
- Revient en partie sur la décision 003 (pas d'abstraction à une seule implémentation) : l'interface de plugin en aura deux dès l'étape 1.
- À la mise à jour, les onglets Tâches mise et Xcode disparaissent tant qu'on n'a pas activé le plugin dans la page Plugins (désactivés par défaut) ; à signaler dans les notes de version.
- `ARCHITECTURE.md` gagne un module `plugins.mjs` (chargeur + SDK, importé par `transport`) et une ligne dans « Où ajouter quoi » : « nouvel outil externe → plugin ».
- Le contrat perd ses schémas propres à mise et à Xcode (majeur, étape 1 bis).
- Une interface de plugin riche (éditeur, graphique, arbre) demandera d'ajouter des nœuds au fil des besoins, jamais du HTML libre.
