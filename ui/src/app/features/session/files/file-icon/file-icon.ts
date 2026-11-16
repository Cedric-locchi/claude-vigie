/**
 * Icône de type de fichier, monochrome (la couleur reste aux états, règle Lights-Out) : un mini-badge de 1 à 3 caractères
 * pour les langages courants, sinon un glyphe en trait (image, réglage, verrou, document).
 */
export type FileIcon = { badge: string } | { glyph: 'image' | 'gear' | 'lock' | 'file' };

const BADGES: Record<string, string> = {
  ts: 'TS', mts: 'TS', cts: 'TS', tsx: 'TSX', js: 'JS', mjs: 'JS', cjs: 'JS', jsx: 'JSX',
  json: '{}', jsonc: '{}', json5: '{}', md: 'MD', mdx: 'MD', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  html: '<>', htm: '<>', xml: '<>', vue: '<>', svelte: '<>', svg: '<>',
  sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', py: 'PY', rb: 'RB', go: 'GO', rs: 'RS', java: 'JV', kt: 'KT', swift: 'SW',
  c: 'C', h: 'H', cpp: 'C++', hpp: 'H', cs: 'C#', php: 'PHP', sql: 'SQL', yml: 'YML', yaml: 'YML', toml: 'TML', ini: 'INI',
  txt: 'TXT', csv: 'CSV', lua: 'LUA',
};
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'icns']);
const LOCKS = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'cargo.lock', 'gemfile.lock', 'poetry.lock', 'composer.lock']);
const CONFIGS = new Set(['dockerfile', 'makefile', 'procfile', 'license', 'codeowners']);

export function fileIcon(path: string): FileIcon {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (LOCKS.has(name) || name.endsWith('.lock')) return { glyph: 'lock' };
  const dot = name.lastIndexOf('.');
  // Fichier caché sans autre extension (.gitignore, .env.local, .npmrc) : réglage.
  if (name.startsWith('.') && (dot === 0 || !BADGES[name.slice(dot + 1)])) return { glyph: 'gear' };
  if (CONFIGS.has(name)) return { glyph: 'gear' };
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  if (IMAGES.has(ext)) return { glyph: 'image' };
  return BADGES[ext] ? { badge: BADGES[ext] } : { glyph: 'file' };
}
