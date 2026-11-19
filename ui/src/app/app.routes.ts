import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'Vigie — Dashboard', loadComponent: () => import('./features/sessions/sessions-page/sessions-page.component').then((m) => m.SessionsPageComponent) },
  { path: 'new', title: 'Vigie — Nouvelle session', loadComponent: () => import('./features/new-session/new-session.component').then((m) => m.NewSessionComponent) },
  { path: 'sessions/:id', title: 'Vigie — Session', loadComponent: () => import('./features/session/session-page/session-page.component').then((m) => m.SessionPageComponent), canDeactivate: [(c: { vm: { leave(): Promise<boolean> } }) => c.vm.leave()] },
  { path: 'usage', title: 'Vigie — Consommation', loadComponent: () => import('./features/usage/usage-page/usage-page.component').then((m) => m.UsagePageComponent) },
  { path: 'plugins', title: 'Vigie — Plugins', loadComponent: () => import('./features/plugins/plugins-page.component').then((m) => m.PluginsPageComponent) },
  { path: 'settings', title: 'Vigie — Réglages', loadComponent: () => import('./features/settings/settings-page.component').then((m) => m.SettingsPageComponent) },
  { path: 'terminal/:id', title: 'Vigie — Terminal', loadComponent: () => import('./features/terminal/terminal-window/terminal-window.component').then((m) => m.TerminalWindowComponent) },
  { path: '**', redirectTo: '' },
];
