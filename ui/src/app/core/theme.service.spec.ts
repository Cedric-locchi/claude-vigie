import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  afterEach(() => localStorage.clear());

  it('applique le thème choisi sur <html> et le mémorise', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('light');
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(localStorage.getItem('vigie-theme')).toBe('light');
  });

  it('reprend le choix mémorisé au démarrage', () => {
    localStorage.setItem('vigie-theme', 'light');
    expect(TestBed.inject(ThemeService).theme()).toBe('light');
  });
});
