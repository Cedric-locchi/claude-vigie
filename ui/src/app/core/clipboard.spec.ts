import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPIED_MS, clipboardCopy } from './clipboard';

const navigator = () => document.defaultView!.navigator;
const stubClipboard = (writeText: (t: string) => Promise<void>) =>
  Object.defineProperty(navigator(), 'clipboard', { value: { writeText }, configurable: true });
const create = () => TestBed.runInInjectionContext(() => clipboardCopy());

describe('clipboardCopy', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator(), 'clipboard');
  });

  it('copie le texte, « Copié » pendant 1,5 s ; une nouvelle copie relance le délai', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    vi.useFakeTimers();
    const c = create();
    await c.copy('a');
    expect(writeText).toHaveBeenCalledWith('a');
    expect(c.copied()).toBe(true);
    vi.advanceTimersByTime(COPIED_MS - 100);
    await c.copy('b');
    vi.advanceTimersByTime(200);
    expect(c.copied()).toBe(true);
    vi.advanceTimersByTime(COPIED_MS);
    expect(c.copied()).toBe(false);
  });

  it('presse-papiers refusé ou absent : pas d’erreur, rien ne change', async () => {
    stubClipboard(() => Promise.reject(new DOMException('refusé', 'NotAllowedError')));
    const c = create();
    await expect(c.copy('a')).resolves.toBeUndefined();
    expect(c.copied()).toBe(false);
    Reflect.deleteProperty(navigator(), 'clipboard');
    await expect(c.copy('a')).resolves.toBeUndefined();
    expect(c.copied()).toBe(false);
  });

  it('minuterie libérée avec le contexte qui l’a créée', async () => {
    stubClipboard(async () => undefined);
    vi.useFakeTimers();
    await create().copy('a');
    expect(vi.getTimerCount()).toBe(1);
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
