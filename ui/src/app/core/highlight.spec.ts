import { describe, expect, it } from 'vitest';
import { highlight, languageOf } from './highlight';

describe('highlight', () => {
  it("colore d'après l'extension, alias compris, et échappe le HTML", () => {
    expect(highlight('src/a.mjs', 'const x = "<b>";')).toContain('<span class="hljs-keyword">const</span>');
    expect(highlight('src/a.mjs', 'const x = "<b>";')).toContain('&lt;b&gt;');
    for (const p of ['a.ts', 'a.json', 'a.md', 'a.yml', 'a.sh', 'a.html', 'a.py', 'a.toml']) expect(highlight(p, 'x'), p).not.toBeNull();
  });
  it('rend null pour un langage inconnu ou sans extension', () => {
    expect(highlight('a.xyz', 'x')).toBeNull();
    expect(highlight('Makefile', 'x')).toBeNull();
    expect(highlight('.gitignore', 'x')).toBeNull();
  });
});

describe('languageOf', () => {
  it("nomme le langage d'après l'extension", () => {
    expect(languageOf('src/a.mjs')).toBe('JavaScript');
    expect(languageOf('a.ts')).toBe('TypeScript');
    expect(languageOf('index.html')).toBe('HTML');
    expect(languageOf('a.xml')).toBe('XML');
    expect(languageOf('Cargo.toml')).toBe('TOML');
    expect(languageOf('Makefile')).toBeNull();
    expect(languageOf('a.xyz')).toBeNull();
  });
});
