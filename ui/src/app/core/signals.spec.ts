import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { counter, keepLast } from './signals';

/** Ressource factice : `value` undefined = en chargement. */
const fakeResource = <T>() => {
  const value = signal<T | undefined>(undefined);
  return { value, res: { hasValue: () => value() !== undefined, value: () => value() } };
};

describe('keepLast', () => {
  it('garde la dernière valeur pendant un rechargement, l’oublie quand la clé change', () => {
    TestBed.runInInjectionContext(() => {
      const { value, res } = fakeResource<number>();
      const id = signal<string | null>('a');
      const last = keepLast(res, id);
      expect(last()).toBeNull();
      value.set(1);
      expect(last()).toBe(1);
      value.set(undefined); // rechargement
      expect(last()).toBe(1);
      id.set('b');
      expect(last()).toBeNull();
      value.set(2);
      id.set(null);
      value.set(undefined);
      expect(last()).toBeNull();
    });
  });

  it('sans clé, garde toujours la dernière valeur', () => {
    TestBed.runInInjectionContext(() => {
      const { value, res } = fakeResource<number>();
      const last = keepLast(res);
      value.set(3);
      expect(last()).toBe(3);
      value.set(undefined);
      expect(last()).toBe(3);
    });
  });
});

describe('counter', () => {
  it('compte les changements retenus de la source', () => {
    TestBed.runInInjectionContext(() => {
      const on = signal(false);
      const all = counter(on);
      const enter = counter(on, (next, was) => next && !was);
      expect([all(), enter()]).toEqual([0, 0]);
      on.set(true);
      expect([all(), enter()]).toEqual([1, 1]);
      on.set(false);
      expect([all(), enter()]).toEqual([2, 1]);
      on.set(true);
      expect([all(), enter()]).toEqual([3, 2]);
    });
  });
});
