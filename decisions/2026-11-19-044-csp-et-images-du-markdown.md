# 044 — CSP de l'UI et images distantes du Markdown

- **Statut :** Acceptée
- **Date :** 2026-11-19
- **Décidé par :** Toi (correction de l'audit d'architecture du 2026-11-19)
- **Complète :** la 011 (sécurité du daemon) et la règle « l'UI ne sort jamais »

## Contexte
L'UI rend du Markdown (README et CLAUDE.md dans Fichiers et Config, messages des agents) par `marked` puis `[innerHTML]`. Le sanitizer d'Angular garde les `<img src="https://…">` : un README avec des badges faisait une requête vers l'extérieur dès son ouverture. Aucune CSP ne l'empêchait.

## Décision
- **Markdown** : rendu uniquement par `ui/src/app/core/markdown.ts` (`renderMarkdown`). Une image distante (`http(s):`, `//`) y est remplacée par son texte alternatif. Aucun composant n'appelle `marked` directement.
- **CSP** : le daemon sert l'UI avec l'en-tête
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:<port> ws://localhost:<port>; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  Construite par une fonction pure du daemon, testée.
- **Conséquence pour l'UI** : aucun script inline ni attribut `on*` dans `index.html` (le script de thème est un fichier de `ui/public/`).

## Raisons
- Le renderer couvre aussi `ng serve` (pas de CSP en dev) ; la CSP rattrape tout ce qui passerait ailleurs (image d'un plugin, police, `fetch`).
- `style-src 'unsafe-inline'` : Angular et spartan posent des styles en ligne ; un style ne fait pas sortir de requête que `img-src`/`font-src` ne bloquent déjà.
- En-tête plutôt que `<meta>` : il couvre `frame-ancestors` et ne gêne pas le serveur de dev (HMR).

## Alternatives écartées
- Proxy local des images : une requête sortante quand même, par le daemon.
- `autoCsp` d'Angular : ne règle que `script-src`, pas les images.

## Conséquences
- Toute ressource nouvelle (wasm, worker, `eval` d'une dépendance) doit tenir dans cette politique, sinon la politique change par une nouvelle décision.
- `daemon/ARCHITECTURE.md` (sécurité) décrit l'en-tête.
