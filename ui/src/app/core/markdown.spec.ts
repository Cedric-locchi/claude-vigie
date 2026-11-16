import { describe, expect, it } from 'vitest';
import { isMarkdown, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it("rend le GFM et garde l'en-tête YAML en bloc de code", () => {
    const html = renderMarkdown('---\nname: revue\n---\n# Titre\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<code class="language-yaml">name: revue');
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<hr>');
  });

  it('reconnaît les fichiers markdown', () => {
    expect([isMarkdown('a/README.md'), isMarkdown('x.MDX'), isMarkdown('x.ts')]).toEqual([true, true, false]);
  });
});
