import { marked } from 'marked';

/** Fichier markdown d'après son extension. */
export const isMarkdown = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path);

/** Attributs par lesquels du HTML charge une ressource (image, vidéo, fond de tableau). */
const URL_ATTRS = ['src', 'srcset', 'poster', 'background'];

/** URL qui sort de la machine : http(s) ou `//` vers un autre hôte. Chemins relatifs et `data:` restent locaux. */
export function isRemote(url: string): boolean {
  try {
    const u = new URL(url, 'http://vigie.invalid/');
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== 'vigie.invalid';
  } catch {
    return false;
  }
}

/**
 * L'UI ne sort jamais (décision 044) : une image distante (badge d'un README…) devient son texte alternatif, un autre
 * élément perd l'attribut qui chargerait l'URL. Vaut pour le Markdown (`![]()`) comme pour le HTML brut (`<img>`, `<video poster>`).
 * Liens : un lien http(s) s'ouvre à côté (navigateur ou nouvel onglet), jamais à la place de l'app ; un autre lien
 * (`CONTRIBUTING.md`, `#ancre`, `mailto:`) perd sa cible et garde son texte : suivi, il rechargerait l'app sans garde.
 */
function localOnly(html: string): string {
  if (!/(?:src|srcset|poster|background|href)\s*=/i.test(html)) return html;
  // Lu comme le relit le sanitizer d'Angular (DOMParser, scripts désactivés) : le contenu d'un <noscript> est fait d'éléments,
  // pas de texte comme dans un <template> ; sans quoi une image distante y passerait le filtre. Document sans fenêtre : rien ne se charge.
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  for (const el of body.querySelectorAll('[src], [srcset], [poster], [background]')) {
    const remote = URL_ATTRS.some((a) => (el.getAttribute(a) ?? '').split(',').some((c) => isRemote(c.trim().split(/\s+/)[0])));
    if (!remote) continue;
    if (el instanceof HTMLImageElement) el.replaceWith(el.alt);
    else for (const a of URL_ATTRS) el.removeAttribute(a);
  }
  for (const a of body.querySelectorAll('[href]')) {
    if (!isRemote(a.getAttribute('href')!)) {
      a.removeAttribute('href');
      continue;
    }
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  return body.innerHTML;
}

/**
 * Markdown GFM rendu en HTML (à passer par [innerHTML], donc par le sanitizer d'Angular) : seul point de rendu de l'app.
 * L'en-tête YAML (skills, agents…) devient un bloc de code : sinon marked en fait un trait et un titre.
 * `breaks` : un retour à la ligne simple devient <br> (messages des agents, écrits comme du texte).
 */
export function renderMarkdown(text: string, { breaks = false } = {}): string {
  const src = text.replace(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/, (_, yaml: string) => '```yaml\n' + yaml + '\n```\n\n');
  return localOnly(marked.parse(src, { async: false, gfm: true, breaks }));
}
