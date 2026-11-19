/**
 * Thème d'icônes des fichiers et dossiers (décision 043) : une forme (glyphe 16 × 16, tracé maison) et une couleur (jeton de styles.css).
 * Fichiers : couleur de leur écosystème (`--ft-*`, exception assumée à la règle des trois couleurs). Dossiers : palette Vigie (`--fd-*`).
 * Fonction pure : le nom suffit, on ne lit jamais le contenu (un `.env` n'est reconnu qu'à son nom).
 */
export type Glyph =
  | 'file' | 'dir' | 'open' | 'ts' | 'js' | 'react' | 'json' | 'md' | 'html' | 'css' | 'image' | 'yaml' | 'toml'
  | 'sh' | 'py' | 'swift' | 'go' | 'rust' | 'lock' | 'env' | 'git' | 'docker';

export interface FileIcon { glyph: Glyph; color: string }

/** Extension → [glyphe, jeton de couleur]. */
const EXT: Record<string, [Glyph, string]> = {
  ts: ['ts', 'ts'], mts: ['ts', 'ts'], cts: ['ts', 'ts'],
  tsx: ['react', 'react'], jsx: ['react', 'react'],
  js: ['js', 'js'], mjs: ['js', 'js'], cjs: ['js', 'js'],
  json: ['json', 'json'], jsonc: ['json', 'json'], json5: ['json', 'json'],
  md: ['md', 'md'], mdx: ['md', 'md'],
  html: ['html', 'html'], htm: ['html', 'html'], xml: ['html', 'html'],
  css: ['css', 'css'], scss: ['css', 'scss'], sass: ['css', 'scss'], less: ['css', 'scss'],
  yaml: ['yaml', 'yaml'], yml: ['yaml', 'yaml'], toml: ['toml', 'toml'], ini: ['toml', 'toml'],
  sh: ['sh', 'sh'], bash: ['sh', 'sh'], zsh: ['sh', 'sh'], fish: ['sh', 'sh'],
  py: ['py', 'py'], swift: ['swift', 'swift'], go: ['go', 'go'], rs: ['rust', 'rust'], lock: ['lock', 'lock'],
};
for (const e of ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'icns']) EXT[e] = ['image', 'image'];
const LOCKS = new Set(['package-lock.json', 'pnpm-lock.yaml', 'bun.lockb', 'npm-shrinkwrap.json']);
const DOCKER = new Set(['dockerfile', '.dockerignore', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);

/** Dossiers connus → jeton `--fd-*` ; les autres prennent `--fd-default`. */
const DIRS: Record<string, string> = {};
const dirs = (tone: string, names: string): void => { for (const n of names.split(' ')) DIRS[n] = tone; };
dirs('src', 'src app lib libs source');
dirs('components', 'components');
dirs('assets', 'assets public images img static icons fonts media');
dirs('tests', 'test tests __tests__ spec specs e2e __mocks__ fixtures');
dirs('docs', 'docs doc decisions');
dirs('scripts', 'scripts bin tools');
dirs('config', 'config .config .github .vscode .claude .idea .husky');
dirs('build', 'node_modules dist build out coverage target .angular .next .cache');

const ft = (t: string): string => `var(--ft-${t})`;

/** Icône d'un fichier ou d'un dossier d'après son nom ou son chemin (casse ignorée). */
export function iconFor(path: string, isDir = false, open = false): FileIcon {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (isDir) return { glyph: open ? 'open' : 'dir', color: `var(--fd-${DIRS[name] ?? 'default'})` };
  if (LOCKS.has(name)) return { glyph: 'lock', color: ft('lock') };
  if (name === '.env' || name.startsWith('.env.')) return { glyph: 'env', color: ft('env') };
  if (name.startsWith('.git')) return { glyph: 'git', color: ft('git') };
  if (DOCKER.has(name) || name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return { glyph: 'docker', color: ft('docker') };
  const dot = name.lastIndexOf('.');
  const hit = dot >= 0 ? EXT[name.slice(dot + 1)] : undefined;
  return hit ? { glyph: hit[0], color: ft(hit[1]) } : { glyph: 'file', color: ft('file') };
}
