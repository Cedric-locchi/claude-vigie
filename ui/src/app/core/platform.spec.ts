import { describe, expect, it } from 'vitest';
import { clientOs, isMac, isShortcut } from './platform';

const nav = (platform: string, userAgent = '') => ({ platform, userAgent });
const key = (k: string, mods: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: k, ...mods });

describe('platform', () => {
  it("reconnaît l'OS du navigateur, userAgent en secours", () => {
    expect(clientOs(nav('MacIntel'))).toBe('mac');
    expect(clientOs(nav('iPad'))).toBe('mac');
    expect(clientOs(nav('Win32'))).toBe('windows');
    expect(clientOs(nav('Linux x86_64'))).toBe('linux');
    expect(clientOs(nav('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'))).toBe('mac');
    expect(isMac(nav('Linux x86_64'))).toBe(false);
  });

  it('raccourci : Cmd sur mac, Ctrl ailleurs, sans autre modificateur', () => {
    expect(isShortcut(key('f', { metaKey: true }), 'f', true)).toBe(true);
    expect(isShortcut(key('f', { ctrlKey: true }), 'f', true)).toBe(false);
    expect(isShortcut(key('F', { ctrlKey: true }), 'f', false)).toBe(true);
    expect(isShortcut(key('f', { metaKey: true }), 'f', false)).toBe(false); // touche Windows/Super
    expect(isShortcut(key('f', { ctrlKey: true, shiftKey: true }), 'f', false)).toBe(false);
    expect(isShortcut(key('Enter', { ctrlKey: true }), 'Enter', false)).toBe(true);
  });
});
