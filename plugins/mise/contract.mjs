// Schémas du plugin mise (décision 037) : partagés par le back (./contract.mjs) et le front (../contract.mjs).
// zod/mini seulement : rien de Vigie ici.
import * as z from 'zod/mini';

const str = z.string();
const nstr = z.nullable(str);

// `source` et `file` : relatifs au cwd s'ils sont dedans, sinon `~/…`, sinon absolus ; `depends` / `run` en texte.
// Tâches globales (`global`) comprises : l'UI filtre. Jamais l'`env` ni les `secrets` d'une tâche.
export const MiseTask = z.object({ name: str, aliases: z.array(str), description: str, source: str, depends: z.array(str), run: z.array(str), file: nstr, global: z.boolean() });
// `available` : faux si mise n'est pas installé ; `untrusted` : config non approuvée (proposer `mise trust`) ; `error` : message de mise.
export const MiseTasks = z.object({ available: z.boolean(), untrusted: z.boolean(), tasks: z.array(MiseTask), error: nstr });
// Action `run` : nom ou alias d'une tâche, relu dans la liste par le back.
export const MiseRunParams = z.object({ task: z.string({ error: 'Tâche mise inconnue' }) });
