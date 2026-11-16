import { DOCUMENT, Service, effect, inject, signal } from '@angular/core';
import { readPref, writePref } from './prefs';

export type Theme = 'light' | 'dark';
const KEY = 'vigie-theme';

/**
 * Thème clair/sombre : choix mémorisé, sinon celui du système.
 * Le script en tête d'index.html pose le même attribut avant le démarrage d'Angular (pas de flash).
 */
@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly win = this.document.defaultView;

  readonly theme = signal<Theme>(this.initial());

  constructor() {
    effect(() => {
      const t = this.theme();
      this.document.documentElement.dataset['theme'] = t;
      // Barre de titre du navigateur : le fond de page du thème, lu dans styles.css plutôt que recopié ici.
      const bg = this.win?.getComputedStyle(this.document.documentElement).getPropertyValue('--bg').trim();
      if (bg) this.document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
    });
  }

  set(theme: Theme): void {
    this.theme.set(theme);
    writePref(KEY, theme);
  }

  private initial(): Theme {
    const saved = readPref(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return this.win?.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
}
