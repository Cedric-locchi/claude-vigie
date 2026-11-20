import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withNavigationErrorHandler } from '@angular/router';
import { provideSpartanHlm } from '@spartan-ng/helm/utils';
import { routes } from './app.routes';
import { AttentionService } from './core/attention.service';
import { LanguageService, provideI18n } from './core/language.service';
import { ThemeService } from './core/theme.service';
import { reloadOnStaleChunk } from './stale-build';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideSpartanHlm(),
    provideHttpClient(withFetch()),
    provideRouter(routes, withComponentInputBinding(), withNavigationErrorHandler((e) => { reloadOnStaleChunk(e); })),
    provideI18n(),
    // Dès le démarrage, sans attendre une page qui les injecte : thème mémorisé appliqué, sessions surveillées (notifications),
    // catalogue de la langue chargé avant le premier rendu.
    provideAppInitializer(() => {
      inject(ThemeService);
      inject(AttentionService);
      return inject(LanguageService).init();
    }),
  ],
};
