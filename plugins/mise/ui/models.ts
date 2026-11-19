import type * as z from 'zod/mini';
import type * as C from '../contract.mjs';

// Types dérivés du contrat du plugin : jamais écrits à la main.
export type MiseTasks = z.infer<typeof C.MiseTasks>;
