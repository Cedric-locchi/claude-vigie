import { describe, expect, it } from 'vitest';
import { iconFor } from './file-icon';

const g = (p: string, dir = false, open = false): string => { const i = iconFor(p, dir, open); return `${i.glyph} ${i.color}`; };

describe('iconFor', () => {
  it('fichiers : forme et couleur de l’écosystème, d’après l’extension (casse ignorée)', () => {
    expect(g('src/app/main.ts')).toBe('ts var(--ft-ts)');
    expect(g('ui/App.TSX')).toBe('react var(--ft-react)');
    expect(g('a.jsx')).toBe('react var(--ft-react)');
    expect(g('daemon/server.mjs')).toBe('js var(--ft-js)');
    expect(g('package.json')).toBe('json var(--ft-json)');
    expect(g('.eslintrc.json')).toBe('json var(--ft-json)');
    expect(g('README.md')).toBe('md var(--ft-md)');
    expect(g('index.html')).toBe('html var(--ft-html)');
    expect(g('a.css')).toBe('css var(--ft-css)');
    expect(g('a.scss')).toBe('css var(--ft-scss)');
    expect(g('logo.svg')).toBe('image var(--ft-image)');
    expect(g('assets/logo.PNG')).toBe('image var(--ft-image)');
    expect(g('.github/ci.yml')).toBe('yaml var(--ft-yaml)');
    expect(g('Cargo.toml')).toBe('toml var(--ft-toml)');
    expect(g('bin/install.sh')).toBe('sh var(--ft-sh)');
    expect(g('a.py')).toBe('py var(--ft-py)');
    expect(g('App.swift')).toBe('swift var(--ft-swift)');
    expect(g('main.go')).toBe('go var(--ft-go)');
    expect(g('lib.rs')).toBe('rust var(--ft-rust)');
  });

  it('noms particuliers : verrous, .env, git, Docker, inconnu', () => {
    expect(g('package-lock.json')).toBe('lock var(--ft-lock)');
    expect(g('pnpm-lock.yaml')).toBe('lock var(--ft-lock)');
    expect(g('sub/Cargo.lock')).toBe('lock var(--ft-lock)');
    expect(g('.env')).toBe('env var(--ft-env)');
    expect(g('.env.local')).toBe('env var(--ft-env)');
    expect(g('.gitignore')).toBe('git var(--ft-git)');
    expect(g('.gitattributes')).toBe('git var(--ft-git)');
    expect(g('Dockerfile')).toBe('docker var(--ft-docker)');
    expect(g('docker-compose.yml')).toBe('docker var(--ft-docker)');
    expect(g('notes')).toBe('file var(--ft-file)');
    expect(g('archive.tar.gz')).toBe('file var(--ft-file)');
  });

  it('dossiers : fermé ou ouvert, couleur dédiée aux dossiers connus', () => {
    expect(g('src', true)).toBe('dir var(--fd-src)');
    expect(g('ui/src/app', true, true)).toBe('open var(--fd-src)');
    expect(g('components', true)).toBe('dir var(--fd-components)');
    expect(g('public', true)).toBe('dir var(--fd-assets)');
    expect(g('__tests__', true)).toBe('dir var(--fd-tests)');
    expect(g('decisions', true)).toBe('dir var(--fd-docs)');
    expect(g('bin', true)).toBe('dir var(--fd-scripts)');
    expect(g('.github', true)).toBe('dir var(--fd-config)');
    expect(g('node_modules', true)).toBe('dir var(--fd-build)');
    expect(g('Dist', true)).toBe('dir var(--fd-build)');
    expect(g('features', true)).toBe('dir var(--fd-default)');
    // Un dossier nommé comme un fichier connu reste un dossier.
    expect(g('a.ts', true)).toBe('dir var(--fd-default)');
  });
});
