// Schémas du plugin Nx (décision 037) : partagés par le back (./contract.mjs) et le front (../contract.mjs).
// La regex est commune : le front grise un bouton, le back refuse. zod/mini seulement : rien de Vigie ici.
import * as z from 'zod/mini';

const str = z.string();
const bool = z.boolean();

// Projet ou cible lançable : ni espace, ni `:` (séparateur de `nx run p:t`), ni antislash, ni caractère de contrôle,
// pas de `-` en tête (option).
// eslint-disable-next-line no-control-regex -- refuser les caractères de contrôle est le but
export const ID = /^(?!-)[^\s:\\\x00-\x1f\x7f]{1,200}$/;

// Méthode `info` (fichiers seulement, rapide) : `local` = node_modules/.bin/nx existe (sinon nx du PATH) ;
// `telemetry` = `"analytics": true` dans nx.json, le graphe n'est alors pas lu.
export const NxInfo = z.object({ local: bool, telemetry: bool });
// `command` : commande (run-commands), contenu du script (package.json) ou exécuteur, coupée à 2 000 ; `runnable` : projet et
// cible passent ID (une cible avec `:` n'a pas de bouton).
export const NxTarget = z.object({ name: str, command: str, description: str, runnable: bool });
// `type` : app, lib, e2e (ou vide) ; `root` relatif à l'espace Nx. Projets et cibles triés par nom.
export const NxProject = z.object({ name: str, type: str, root: str, targets: z.array(NxTarget) });
// Méthode `graph` (lente, jusqu'à 60 s) : `available` faux si nx est introuvable ; `truncated` : projets coupés (réponse
// au-delà de 3 Mo), la liste est partielle ; `error` : message à montrer (télémétrie active, nx en échec ou trop lent, sortie illisible).
export const NxGraph = z.object({ available: bool, projects: z.array(NxProject), truncated: bool, error: z.nullable(str) });
// Action `run` : `nx run <project>:<target>` ; seul nx.json est relu, pas le graphe.
export const NxRunParams = z.object({
  project: z.string({ error: 'Projet invalide' }).check(z.regex(ID, 'Projet invalide')),
  target: z.string({ error: 'Cible invalide' }).check(z.regex(ID, 'Cible invalide')),
});
