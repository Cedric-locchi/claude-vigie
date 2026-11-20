import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSidebarImports, provideHlmSidebarConfig } from '@spartan-ng/helm/sidebar';
import { AppVm } from './app.vm';
import { ConfirmDialogComponent } from './shell/confirm-dialog/confirm-dialog.component';
import { NotificationCenterComponent } from './shell/notification-center/notification-center.component';
import { SearchPaletteComponent } from './shell/search-palette/search-palette.component';
import { SidebarComponent } from './shell/sidebar/sidebar.component';
import { ToastHostComponent } from './shell/toast-host/toast-host.component';

/**
 * Coque : barre latérale (shell/sidebar), bandeaux d'état du daemon, puis la page courante ; dialogue de confirmation, toasts et
 * palette de recherche dans les sessions (⌘F / Ctrl+F).
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HlmBadge, HlmButton, HlmSidebarImports, ConfirmDialogComponent, NotificationCenterComponent, SearchPaletteComponent, SidebarComponent, ToastHostComponent],
  providers: [AppVm, provideHlmSidebarConfig({ sidebarWidth: '18rem', sidebarCookieName: 'vigie_sidebar' })],
  host: { '(document:keydown.meta.n)': 'vm.newSession($event)', '(window:keydown)': 'vm.searchShortcut($event)' },
  template: `
    <div hlmSidebarWrapper [class.offline]="!!vm.offline()">
      <app-sidebar />

      <!-- min-w-0 : sans lui, le contenu le plus large de la page élargit main et toute la page défile sur le côté. -->
      <main hlmSidebarInset class="min-w-0">
        <!-- Mobile : la sidebar devient un panneau, ouvert par ce bouton. -->
        <div class="mobile-bar"><button hlmSidebarTrigger srOnlyText="Ouvrir la barre latérale"></button><span>Vigie</span>@if (vm.waitingCount()) { <span hlmBadge variant="waiting">{{ vm.waitingCount() }} en attente</span> }<span class="bell ms-auto"><app-notification-center /></span></div>
        @if (vm.incompatible()) {
          <p class="incompat" role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
            <span>Le daemon ne parle pas la même version que l'interface : est-il à jour ? (redémarre-le après une mise à jour)</span>
          </p>
        }
        @if (vm.offline(); as o) {
          <div class="offline-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.4-1.7M12 20h.01" /></svg>
            <p><strong role="alert">Vigie ne joint plus le daemon</strong> : ces informations datent de <span class="mono">{{ o.age }}</span>. Redémarre-le avec <span class="mono">{{ vm.restartCommand }}</span>, ou relance l'app.</p>
          </div>
        }
        <router-outlet />
      </main>
    </div>
    <app-confirm-dialog />
    <app-toast-host />
    <!-- Palette de recherche dans les sessions : créée à l'ouverture, chargée à part (hors chargement initial, décision 036). -->
    @if (vm.searchOpen()) {
      @defer (on immediate) { <app-search-palette (closed)="vm.searchOpen.set(false)" /> }
      @error {
        <!-- Chunk introuvable (UI mise à jour onglet ouvert, daemon injoignable) : Angular retient l'échec et chaque réouverture rend ce bloc. -->
        <dialog open class="palette search-error" aria-label="Recherche indisponible" (document:keydown.escape)="vm.searchOpen.set(false)">
          <p role="alert">La recherche n'a pas pu se charger : l'interface a peut-être été mise à jour.</p>
          <div class="actions">
            <button hlmBtn type="button" variant="ghost" size="sm" (click)="vm.searchOpen.set(false)">Fermer</button>
            <button hlmBtn type="button" size="sm" (click)="vm.reloadPage()">Recharger</button>
          </div>
        </dialog>
      }
    }
  `,
  styles: `
    /* Barre latérale détachée (décision 043) posée, comme la zone principale, sur le fond pointillé. */
    [hlmSidebarWrapper] { background: var(--dots); }
    main { background: transparent; }
    .bell { display: flex; }
    /* Règle de défilement (DESIGN.md, Layout ; gabarit shell/page) : au bureau la coque fait la hauteur de la fenêtre et le document ne défile
       jamais (clip : ni barre, ni scrollIntoView) ; la page routée prend la hauteur sous les bandeaux. Téléphone : le document défile. */
    main { overflow-x: clip; }
    @media (min-width: 721px) { main { height: 100dvh; overflow: clip; } }
    :host ::ng-deep main > router-outlet + * { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .mobile-bar, .incompat, .offline-bar { flex: none; }
    /* Hauteur fixe (52px, reprise par --chrome-top et --sticky-top). Collée en haut : le bouton du menu reste à portée en bas d'une longue page. */
    .mobile-bar { display: none; position: sticky; top: 0; z-index: 10; height: 52px; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--bg); font-weight: 600; }
    @media (max-width: 767px) { .mobile-bar { display: flex; } }
    /* Bandeau de version : hauteur fixe, ajoutée à --chrome-top (hauteur propre du terminal et de l'éditeur sur téléphone). */
    .incompat { display: flex; align-items: center; gap: 8px; height: 36px; margin: 0; padding: 0 16px; border-bottom: 1px solid var(--err-line); background: var(--err-bg); color: var(--err); font-size: 12px; }
    .incompat svg { flex: none; }
    .incompat span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    main:has(> .incompat) { --chrome-top: 36px; }
    @media (max-width: 767px) { main:has(> .incompat) { --chrome-top: 88px; } }
    /* Daemon injoignable : même bandeau corail, sur deux lignes au plus (la commande ne se coupe pas). */
    .offline-bar { display: flex; align-items: flex-start; gap: 8px; height: var(--offline-h); margin: 0; padding: 9px 16px; overflow-y: auto; border-bottom: 1px solid var(--err-line); background: var(--err-bg); color: var(--err); font-size: 12px; line-height: 1.5; }
    .offline-bar svg { flex: none; margin-top: 2px; }
    .offline-bar p { min-width: 0; overflow-wrap: anywhere; }
    .offline-bar strong { font-weight: 600; }
    /* Hauteur du bandeau fixée (2 lignes bureau, 4 sur téléphone) et reprise dans --chrome-top : un message plus long défile dans le bandeau au lieu de pousser la page. */
    main:has(> .offline-bar) { --offline-h: 56px; --chrome-top: var(--offline-h); }
    @media (max-width: 767px) { main:has(> .offline-bar) { --offline-h: 88px; --chrome-top: calc(52px + var(--offline-h)); } }
    /* État figé : sessions et page passent en gris, l'ambre et le bleu ne font plus croire à un état vivant. */
    /* ::ng-deep : la page routée n'hérite pas de l'attribut de style du shell. */
    :host ::ng-deep .offline :is([hlmSidebarContent], main > :not(.mobile-bar, .incompat, .offline-bar, router-outlet)) { filter: grayscale(0.85); transition: filter var(--dur) var(--ease); }
    /* Palette impossible à charger : même fenêtre flottante (.palette, styles.css), non modale donc posée au-dessus de la coque. */
    .search-error { z-index: 50; gap: 12px; padding: 14px 16px; }
    .search-error p { margin: 0; font-size: 13px; color: var(--err); }
    .search-error .actions { display: flex; justify-content: flex-end; gap: 8px; }
  `,
})
export class App {
  protected readonly vm = inject(AppVm);
}
