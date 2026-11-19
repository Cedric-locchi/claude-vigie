import type * as z from 'zod/mini';
import type * as C from '../contract.mjs';

// Types dérivés du contrat du plugin : jamais écrits à la main.
export type NxInfo = z.infer<typeof C.NxInfo>;
export type NxGraph = z.infer<typeof C.NxGraph>;
export type NxTarget = z.infer<typeof C.NxTarget>;
