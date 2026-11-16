// jsdom n'implémente pas ResizeObserver, utilisé par les popovers spartan (autocomplete, select).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// Préférences (localStorage) remises à zéro avant chaque test : sinon une préférence écrite par un test
// (vue du panneau Fichiers, thème…) fuit dans le suivant selon l'ordre d'exécution, qui diffère en CI.
import { beforeEach } from 'vitest';
beforeEach(() => { try { localStorage.clear(); } catch { /* stockage absent */ } });
