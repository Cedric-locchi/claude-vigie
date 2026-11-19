import type * as z from 'zod/mini';
import type * as C from '../contract.mjs';

// Types dérivés du contrat du plugin : jamais écrits à la main.
export type XcodeContainer = z.infer<typeof C.XcodeContainer>;
export type XcodeProject = z.infer<typeof C.XcodeProject>;
export type XcodeTargets = z.infer<typeof C.XcodeTargets>;
export type Simulator = z.infer<typeof C.Simulator>;
export type XcodeAction = z.infer<typeof C.XcodeAction>;
