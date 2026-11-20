import { Injectable, importProvidersFrom } from '@angular/core';
import { TranslocoMissingHandler, TranslocoTestingModule, provideTranslocoMissingHandler } from '@jsverse/transloco';
import { I18N_CONFIG } from './app/core/language.service';
import en from './i18n/en.json';
import fr from './i18n/fr.json';

// Providers de tous les specs (option `providersFile` du builder de tests) : catalogues chargés d'avance, français actif.
// LanguageService.init() n'est jamais appelé ici (jsdom annonce en-US).

/** Une clé absente fait échouer le test au lieu d'afficher la clé. */
@Injectable()
class MissingKeyFails implements TranslocoMissingHandler {
  handle(key: string): never { throw new Error(`Clé de traduction absente : ${key}`); }
}

export default [
  importProvidersFrom(TranslocoTestingModule.forRoot({ langs: { fr, en }, preloadLangs: true, translocoConfig: I18N_CONFIG })),
  // Après le module : le dernier provider du jeton l'emporte.
  provideTranslocoMissingHandler(MissingKeyFails),
];
