import { describe, expect, it, vi } from 'vitest';
import { NavigationError } from '@angular/router';
import { isStaleChunk, reloadOnStaleChunk } from './stale-build';

const fakeWin = () => {
  const store = new Map<string, string>();
  return {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    location: { assign: vi.fn() },
  } as unknown as Window & { location: { assign: ReturnType<typeof vi.fn> } };
};

describe('reloadOnStaleChunk', () => {
  it('reconnaît un fichier de page disparu, pas une autre erreur', () => {
    expect(isStaleChunk(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:4317/chunk-AB.js'))).toBe(true);
    expect(isStaleChunk(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('recharge sur l’adresse visée, une seule fois par 10 s', () => {
    const win = fakeWin();
    const err = new NavigationError(1, '/usage', new TypeError('Failed to fetch dynamically imported module'));
    expect(reloadOnStaleChunk(err, win)).toBe(true);
    expect(win.location.assign).toHaveBeenCalledWith('/usage');
    expect(reloadOnStaleChunk(err, win)).toBe(false);
    expect(reloadOnStaleChunk(new NavigationError(2, '/usage', new Error('autre')), fakeWin())).toBe(false);
  });
});
