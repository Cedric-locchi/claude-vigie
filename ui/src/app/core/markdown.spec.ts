import { describe, expect, it } from 'vitest';
import { isMarkdown, isRemote, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it("rend le GFM et garde l'en-tête YAML en bloc de code", () => {
    const html = renderMarkdown('---\nname: revue\n---\n# Titre\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<code class="language-yaml">name: revue');
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<hr>');
  });

  it('remplace une image distante par son texte alternatif, garde une image locale', () => {
    const html = renderMarkdown('[![build](https://img.shields.io/b.svg)](https://ci) ![logo](docs/logo.png) ![x](//cdn.example/x.png)');
    expect(html).not.toMatch(/shields|cdn\.example/);
    expect(html).toContain('>build</a>'); // le lien reste, l'image devient son texte
    expect(html).toContain('<img src="docs/logo.png" alt="logo">');
  });

  it('retire les URL distantes du HTML brut (img, srcset, poster, background)', () => {
    const html = renderMarkdown([
      '<p align="center"><img src="https://x.dev/a.png" alt="Bannière"></p>',
      '',
      '<IMG SRC = " HTTPS://x.dev/b.png">',
      '<img srcset="a.png 1x, https://x.dev/c.png 2x" alt="c">',
      '<video src="v.mp4" poster="https://x.dev/p.png"></video>',
      '<table background="//x.dev/t.png"><tr><td>t</td></tr></table>',
    ].join('\n'));
    expect(html).not.toMatch(/x\.dev/i);
    expect(html).toContain('Bannière');
    expect(html).toContain('<p align="center">'); // structure gardée
  });

  it("lit le contenu d'un <noscript> comme le sanitizer d'Angular : des éléments, filtrés comme les autres", () => {
    const html = renderMarkdown('Texte\n\n<noscript><img src="https://x.dev/n.png" alt="pixel"></noscript>');
    expect(html).not.toMatch(/x\.dev/);
    expect(html).toContain('<noscript>pixel</noscript>');
  });

  it("ouvre un lien http(s) à côté de l'app, retire la cible d'un lien relatif ou d'un autre schéma", () => {
    const html = renderMarkdown('[guide](CONTRIBUTING.md) [ancre](#install) [mail](mailto:a@b.c) [site](https://x.dev) <a href="//x.dev/y">brut</a>');
    expect(html).toContain('<a>guide</a>');
    expect(html).toContain('<a>ancre</a>');
    expect(html).toContain('<a>mail</a>');
    expect(html).toContain('<a href="https://x.dev" target="_blank" rel="noopener noreferrer">site</a>');
    expect(html).toContain('<a href="//x.dev/y" target="_blank" rel="noopener noreferrer">brut</a>');
  });

  it("reconnaît une URL qui sort de la machine", () => {
    expect(['https://a.b/c', 'http://a.b', '//a.b/c', ' HTTPS://A.B', 'ht\ttps://a.b'].map(isRemote)).toEqual([true, true, true, true, true]);
    expect(['a.png', './a.png', '/a.png', 'data:image/png;base64,AAA', '', 'javascript:alert(1)'].map(isRemote)).toEqual([false, false, false, false, false, false]);
  });

  it('retour à la ligne simple en <br> seulement sur demande (messages des agents)', () => {
    expect(renderMarkdown('a\nb')).not.toContain('<br>');
    expect(renderMarkdown('a\nb', { breaks: true })).toContain('<br>');
  });

  it('reconnaît les fichiers markdown', () => {
    expect([isMarkdown('a/README.md'), isMarkdown('x.MDX'), isMarkdown('x.ts')]).toEqual([true, true, false]);
  });
});
