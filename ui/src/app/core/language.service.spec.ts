import { TestBed } from '@angular/core/testing';
import { Translation, TranslocoService } from '@jsverse/transloco';
import { Subject, throwError } from 'rxjs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { LanguageService, initialLang } from './language.service';

/** Catalogue aplati : `{ settings: { title } }` → `{ 'settings.title': … }`. */
const flat = (o: object, at = ''): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? Object.entries(flat(v, `${at}${k}.`)) : [[`${at}${k}`, v]]));

const params = (v: unknown) => [...String(v).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

/** <html lang> est partagé par les tests du fichier : remis tel quel à la fin. */
const keepHtmlLang = () => { const before = document.documentElement.lang; onTestFinished(() => { document.documentElement.lang = before; }); };

describe('initialLang', () => {
  it('choix mémorisé, sinon la langue du système (fr* → français, sinon anglais)', () => {
    expect(initialLang('en', 'fr-FR')).toBe('en');
    expect(initialLang(null, 'fr-CA')).toBe('fr');
    expect(initialLang(null, 'FR')).toBe('fr');
    expect(initialLang(null, 'de-DE')).toBe('en');
    expect(initialLang('xx', undefined)).toBe('en');
  });
});

describe('LanguageService', () => {
  it('bascule en anglais, le mémorise et le pose sur <html>', async () => {
    keepHtmlLang();
    const language = TestBed.inject(LanguageService);
    expect(language.lang()).toBe('fr');
    await language.set('en');
    expect(language.lang()).toBe('en');
    expect(TestBed.inject(TranslocoService).translate('settings.title')).toBe('Settings');
    expect(localStorage.getItem('vigie-lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('démarre dans la langue mémorisée', async () => {
    keepHtmlLang();
    localStorage.setItem('vigie-lang', 'en');
    const language = TestBed.inject(LanguageService);
    await language.init();
    expect(language.lang()).toBe('en');
  });

  it('catalogue mémorisé introuvable au démarrage : le français, catalogue chargé', async () => {
    keepHtmlLang();
    document.documentElement.lang = '';
    localStorage.setItem('vigie-lang', 'en');
    const transloco = TestBed.inject(TranslocoService);
    const load = transloco.load.bind(transloco);
    const spy = vi.spyOn(transloco, 'load').mockImplementation((l) => (l === 'en' ? throwError(() => new Error('chunk')) : load(l)));
    const language = TestBed.inject(LanguageService);
    await expect(language.init()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('fr');
    expect([language.lang(), document.documentElement.lang]).toEqual(['fr', 'fr']);
  });

  it('aucun catalogue chargeable : init() se résout quand même, en français', async () => {
    keepHtmlLang();
    document.documentElement.lang = '';
    localStorage.setItem('vigie-lang', 'en');
    vi.spyOn(TestBed.inject(TranslocoService), 'load').mockReturnValue(throwError(() => new Error('chunk')));
    const language = TestBed.inject(LanguageService);
    await expect(language.init()).resolves.toBeUndefined();
    expect([language.lang(), document.documentElement.lang]).toEqual(['fr', '']);
  });

  it('clics fr → en → fr : la réponse en retard de « en » ne s’applique pas', async () => {
    keepHtmlLang();
    const transloco = TestBed.inject(TranslocoService);
    const load = transloco.load.bind(transloco);
    const en$ = new Subject<Translation>();
    vi.spyOn(transloco, 'load').mockImplementation((l) => (l === 'en' ? en$ : load(l)));
    const language = TestBed.inject(LanguageService);
    const toEn = language.set('en');
    await language.set('fr');
    en$.next({});
    await toEn;
    expect([language.lang(), localStorage.getItem('vigie-lang'), document.documentElement.lang]).toEqual(['fr', 'fr', 'fr']);
  });

  it('catalogue introuvable : set() se résout, langue et choix mémorisé inchangés', async () => {
    keepHtmlLang();
    document.documentElement.lang = '';
    vi.spyOn(TestBed.inject(TranslocoService), 'load').mockReturnValue(throwError(() => new Error('chunk')));
    const language = TestBed.inject(LanguageService);
    await expect(language.set('en')).resolves.toBeUndefined();
    expect([language.lang(), localStorage.getItem('vigie-lang'), document.documentElement.lang]).toEqual(['fr', null, '']);
  });

  it('une clé absente lève dans les specs (pas de clé affichée en douce)', () => {
    expect(() => TestBed.inject(TranslocoService).translate('settings.nope')).toThrow('Clé de traduction absente : settings.nope');
  });
});

describe('catalogues', () => {
  const [f, e] = [flat(fr), flat(en)];

  it('fr et en ont les mêmes clés', () => {
    expect(Object.keys(e).sort()).toEqual(Object.keys(f).sort());
  });

  it('chaque valeur est une chaîne non vide sans HTML (décision 044), avec les mêmes paramètres dans les deux langues', () => {
    for (const [key, v] of Object.entries(f)) {
      for (const value of [v, e[key]]) {
        expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
        expect(value, key).not.toMatch(/[<>]/);
      }
      expect(params(e[key]), key).toEqual(params(v));
    }
  });
});
