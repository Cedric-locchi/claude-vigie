import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withNavigationErrorHandler } from '@angular/router';
import { provideSpartanHlm } from '@spartan-ng/helm/utils';
import { routes } from './app.routes';
import { reloadOnStaleChunk } from './stale-build';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideSpartanHlm(),
    provideHttpClient(withFetch()),
    provideRouter(routes, withComponentInputBinding(), withNavigationErrorHandler((e) => { reloadOnStaleChunk(e); })),
  ],
};
