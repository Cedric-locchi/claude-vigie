import { marked } from 'marked';

/** Fichier markdown d'après son extension. */
export const isMarkdown = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path);

/**
 * Markdown GFM rendu en HTML (à passer par [innerHTML], donc par le sanitizer d'Angular).
 * L'en-tête YAML (skills, agents…) devient un bloc de code : sinon marked en fait un trait et un titre.
 */
export function renderMarkdown(text: string): string {
  const src = text.replace(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/, (_, yaml: string) => '```yaml\n' + yaml + '\n```\n\n');
  return marked.parse(src, { async: false, gfm: true });
}
