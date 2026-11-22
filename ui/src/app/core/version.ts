// Version de l'app, lue au build dans le package.json racine (bumpé à chaque session, CLAUDE.md) : seule la chaîne entre au bundle.
// ponytail: version de l'interface ; un daemon d'une autre version est signalé par le bandeau de app.ts, pas ici.
export { version as APP_VERSION } from '../../../../package.json';
