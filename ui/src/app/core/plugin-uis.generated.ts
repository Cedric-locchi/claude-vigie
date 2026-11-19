// Généré par scripts/plugin-uis.mjs : ne pas éditer.
import type { Type } from '@angular/core';
export const PLUGIN_UIS: Readonly<Record<string, () => Promise<{ default: Type<unknown> }>>> = {
  mise: () => import('../../../../plugins/mise/ui/index'),
  npm: () => import('../../../../plugins/npm/ui/index'),
  nx: () => import('../../../../plugins/nx/ui/index'),
  xcode: () => import('../../../../plugins/xcode/ui/index'),
};
