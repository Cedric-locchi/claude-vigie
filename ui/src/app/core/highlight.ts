import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// ponytail: langages courants seulement (le cœur seul garde le bundle léger) ; en ajouter un = une ligne ici.
for (const [name, lang] of Object.entries({ bash, css, ini, java, javascript, json, markdown, python, scss, sql, typescript, xml, yaml })) hljs.registerLanguage(name, lang);

const extOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** Contenu coloré en HTML échappé (spans `hljs-*`) d'après l'extension du chemin ; null si le langage est inconnu. */
export function highlight(path: string, content: string): string | null {
  const ext = extOf(path);
  return ext && hljs.getLanguage(ext) ? hljs.highlight(content, { language: ext, ignoreIllegals: true }).value : null;
}

/** Nom lisible du langage (« TypeScript », « YAML ») d'après l'extension ; null si inconnu. */
export function languageOf(path: string): string | null {
  const ext = extOf(path), lang = ext ? hljs.getLanguage(ext) : undefined;
  if (!lang?.name) return null;
  // Noms composés de highlight.js (« HTML, XML », « TOML, also INI ») : l'extension tranche.
  return ext === 'xml' || ext === 'ini' ? ext.toUpperCase() : lang.name.split(',')[0];
}
