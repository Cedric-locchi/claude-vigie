import { describe, expect, it } from 'vitest';
import { fileIcon } from './file-icon';

describe('fileIcon', () => {
  it('mini-badge pour les langages courants, d’après l’extension (casse ignorée)', () => {
    expect(fileIcon('src/app/main.ts')).toEqual({ badge: 'TS' });
    expect(fileIcon('ui/App.TSX')).toEqual({ badge: 'TSX' });
    expect(fileIcon('daemon/server.mjs')).toEqual({ badge: 'JS' });
    expect(fileIcon('package.json')).toEqual({ badge: '{}' });
    expect(fileIcon('README.md')).toEqual({ badge: 'MD' });
    expect(fileIcon('index.html')).toEqual({ badge: '<>' });
    expect(fileIcon('bin/install.sh')).toEqual({ badge: 'sh' });
    expect(fileIcon('.github/ci.yml')).toEqual({ badge: 'YML' });
  });

  it('glyphes : verrou, réglage, image, document par défaut', () => {
    expect(fileIcon('package-lock.json')).toEqual({ glyph: 'lock' });
    expect(fileIcon('sub/Cargo.lock')).toEqual({ glyph: 'lock' });
    expect(fileIcon('.gitignore')).toEqual({ glyph: 'gear' });
    expect(fileIcon('.env.local')).toEqual({ glyph: 'gear' });
    expect(fileIcon('Dockerfile')).toEqual({ glyph: 'gear' });
    expect(fileIcon('assets/logo.PNG')).toEqual({ glyph: 'image' });
    expect(fileIcon('notes')).toEqual({ glyph: 'file' });
    expect(fileIcon('archive.tar.gz')).toEqual({ glyph: 'file' });
  });

  it('un fichier caché qui porte une extension connue garde son badge', () => {
    expect(fileIcon('.eslintrc.json')).toEqual({ badge: '{}' });
  });
});
