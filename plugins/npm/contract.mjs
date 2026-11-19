// Schémas du plugin npm (décision 037) : partagés par le back (./contract.mjs) et le front (../contract.mjs).
// zod/mini seulement : rien de Vigie ici.
import * as z from 'zod/mini';

const str = z.string();
const nstr = z.nullable(str);

// Seuls les scripts lançables sont listés (nom sans `-` en tête ni caractère de contrôle, 200 caractères au plus) ;
// `command` coupée à 2 000 caractères.
export const NpmScript = z.object({ name: str, command: str });
// `dir` relatif au cwd de la session ; `name` = champ `name` de son package.json (un workspace sans nom n'est pas listé).
export const NpmWorkspace = z.object({ name: str, dir: str, scripts: z.array(NpmScript) });
// `pm` : gestionnaire retenu ; `from` : d'où vient ce choix (« packageManager », « pnpm-lock.yaml », « ../../yarn.lock »,
// « par défaut ») ; `warning` : lockfiles multiples ou en désaccord avec packageManager, motif de workspace refusé.
// `truncated` : plus de 200 workspaces, ou réponse trop longue ; `error` : package.json absent ou illisible.
export const NpmProject = z.object({
  pm: z.enum(['npm', 'pnpm', 'yarn', 'bun']), from: str, warning: nstr,
  scripts: z.array(NpmScript),
  workspaces: z.array(NpmWorkspace),
  truncated: z.boolean(), error: nstr,
});
// Action `run` : script de la racine (`workspace` absent ou null) ou d'un workspace (son `name`), relus par le back.
export const NpmRunParams = z.object({ script: z.string({ error: 'Script inconnu' }), workspace: z.optional(z.nullable(z.string({ error: 'Workspace inconnu' }))) });
