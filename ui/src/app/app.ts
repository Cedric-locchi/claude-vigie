import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmSidebarImports, provideHlmSidebarConfig } from '@spartan-ng/helm/sidebar';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { AppVm } from './app.vm';
import { AttentionService } from './core/attention.service';
import { ConfirmDialogComponent } from './core/confirm-dialog.component';
import { NotificationCenterComponent } from './core/notification-center.component';
import { ToastHostComponent } from './core/toast-host.component';
import * as f from './core/format';
import { Icon } from './core/icon.component';
import { ThemeService } from './core/theme.service';

/**
 * Shell : sidebar spartan repliable (Cmd+B sur mac, ou icônes seules), avec toutes les sessions du jour
 * groupées par état pour les suivre d'un coup d'œil, puis la page courante.
 */
@Component({
  selector: 'app-root',
  imports: [Icon, RouterOutlet, RouterLink, HlmBadge, HlmButton, HlmKbd, HlmProgressImports, HlmSidebarImports, HlmTooltip, ConfirmDialogComponent, NotificationCenterComponent, ToastHostComponent],
  providers: [AppVm, provideHlmSidebarConfig({ sidebarWidth: '18rem', sidebarCookieName: 'vigie_sidebar' })],
  host: { '(document:keydown.meta.n)': 'vm.newSession($event)' },
  template: `
    <div hlmSidebarWrapper [class.offline]="!!vm.offline()">
      <hlm-sidebar collapsible="icon">
        <div hlmSidebarHeader>
          <div class="brand">
            <svg class="logo" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>
            <span class="name">Vigie</span>
            <span class="bell ms-auto"><app-notification-center /></span>
            <button hlmSidebarTrigger class="expanded-only" srOnlyText="Replier la barre latérale" [hlmTooltip]="vm.mac ? 'Replier (⌘B)' : 'Replier'"></button>
          </div>

          <!-- Replié : le bouton pour déplier reste en haut, sous le logo. -->
          <button hlmSidebarTrigger class="collapsed-only" srOnlyText="Déplier la barre latérale" [hlmTooltip]="vm.mac ? 'Déplier (⌘B)' : 'Déplier'"></button>
          @let p = vm.pulse();
          <a routerLink="/usage" class="pulse expanded-only" aria-label="Consommation : ouvrir la page complète">
            <span class="pulse-row"><span>Fenêtre 5 h</span><span class="mono">{{ p.window ? f.pct(p.window.pct) : '—' }}</span></span>
            <hlm-progress [value]="p.window?.bar ?? 0" aria-hidden="true"><hlm-progress-indicator /></hlm-progress>
            <span class="pulse-row"><span>Aujourd'hui</span><span class="mono">{{ f.usd(p.todayCost) }}</span></span>
            @if (p.window?.limitAt; as at) { <span class="limit">Limite vers {{ f.clock(at) }}</span> }
          </a>
        </div>

        <div hlmSidebarContent>
          <div hlmSidebarGroup>
            <ul hlmSidebarMenu>
              <li hlmSidebarMenuItem>
                <a hlmSidebarMenuButton routerLink="/" [isActive]="vm.page() === '/'" [attr.aria-current]="vm.page() === '/' ? 'page' : null" tooltip="Sessions">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>
                  <span>Sessions</span>
                </a>
                <span hlmSidebarMenuBadge>{{ vm.active().length }}</span>
              </li>
              <li hlmSidebarMenuItem>
                <a hlmSidebarMenuButton routerLink="/usage" [isActive]="vm.page() === '/usage'" [attr.aria-current]="vm.page() === '/usage' ? 'page' : null" tooltip="Consommation">
                  <svg appIcon="usage" width="16" height="16"></svg>
                  <span>Consommation</span>
                </a>
              </li>
              <li hlmSidebarMenuItem>
                <a hlmSidebarMenuButton routerLink="/new" [isActive]="vm.page() === '/new'" [attr.aria-current]="vm.page() === '/new' ? 'page' : null" [tooltip]="vm.mac ? 'Nouvelle session (⌘N)' : 'Nouvelle session'">
                  <svg appIcon="plus" width="16" height="16"></svg>
                  <span>Nouvelle session</span>
                </a>
                @if (vm.mac) { <span hlmSidebarMenuBadge><kbd hlmKbd>⌘N</kbd></span> }
              </li>
            </ul>
          </div>

          <div hlmSidebarGroup class="expanded-only">
            <input hlmSidebarInput type="search" aria-label="Filtrer les sessions" placeholder="Filtrer les sessions…" [value]="vm.filter()" (input)="vm.setFilter($any($event.target).value)" />
          </div>

          @for (g of vm.groups(); track g.key) {
            <div hlmSidebarGroup [attr.data-group]="g.key">
              @if (g.key === 'done') {
                <button hlmSidebarGroupLabel type="button" [attr.aria-expanded]="vm.doneOpen()" (click)="vm.toggleDone()">
                  {{ g.label }} · {{ g.rows.length }}
                  <svg appIcon="chevron" class="chevron" [class.open]="vm.doneOpen()" width="14" height="14"></svg>
                </button>
              } @else {
                <div hlmSidebarGroupLabel>{{ g.label }} · {{ g.rows.length }}</div>
              }
              @if (g.key !== 'done' || vm.doneOpen()) {
                <ul hlmSidebarMenu>
                  @for (r of g.rows; track r.s.id) {
                    <li hlmSidebarMenuItem>
                      <a hlmSidebarMenuButton size="lg" class="session" [class.urgent]="r.urgent" [class.wait-arrive]="r.urgent" [class.with-badge]="!r.canAllow"
                        [routerLink]="['/sessions', r.s.id]" [isActive]="vm.activeId() === r.s.id" [attr.aria-current]="vm.activeId() === r.s.id ? 'page' : null"
                        [tooltip]="r.s.title + ' — ' + r.doing">
                        <span class="initial" aria-hidden="true">{{ r.s.title.charAt(0).toUpperCase() || '?' }}</span>
                        <span class="dot" [class]="'dot dot-' + r.s.state" [class.pulse-dot]="r.urgent"><span class="sr-only">{{ r.label }}</span></span>
                        <span class="lines">
                          <span class="title">{{ r.s.title }}</span>
                          <span class="sub" [class.wait]="r.urgent" [class.mono]="r.urgent || r.s.state === 'running'">
                            @if (r.urgent || r.s.state === 'running') { {{ r.doing }} } @else { {{ r.s.project }}@if (r.s.branch) { · {{ r.s.branch }} } }
                          </span>
                        </span>
                      </a>
                      @if (r.canAllow) {
                        <button hlmSidebarMenuAction class="allow" [attr.aria-label]="'Autoriser : ' + r.doing" hlmTooltip="Autoriser" (click)="vm.allow(r.s)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                        </button>
                      } @else {
                        <span hlmSidebarMenuBadge class="meta">
                          @if (r.s.state === 'running') {
                            <span class="spark" [class.stale]="r.stale" aria-hidden="true">@for (h of r.spark; track $index) { <i [style.--h]="h / 12"></i> }</span>
                          } @else if (r.s.state === 'done') {
                            <span class="mono">{{ f.usd(r.s.cost ?? 0) }}</span>
                          } @else {
                            <span class="mono">{{ f.duration(r.age) }}</span>
                          }
                        </span>
                      }
                      @if (r.canAllow && vm.replyError()?.id === r.s.id) { <p class="row-error expanded-only" role="alert">{{ vm.replyError()?.message }}</p> }
                    </li>
                  }
                </ul>
              }
            </div>
          } @empty {
            <div hlmSidebarGroup class="expanded-only"><p class="empty">{{ vm.filter() ? 'Aucune session ne correspond.' : "Aucune session aujourd'hui." }}</p></div>
          }
        </div>

        <div hlmSidebarFooter>
          @if (vm.claudeStatus(); as cs) {
            <div class="claude-status" [title]="cs.label">
              <a class="cs-main" href="https://status.claude.com" target="_blank" rel="noopener" [attr.aria-label]="cs.label + ' : ouvrir status.claude.com'">
                <span [class]="'dot cs-' + cs.tone" aria-hidden="true"></span>
                <span class="expanded-only">{{ cs.label }}</span>
              </a>
              @for (i of cs.incidents; track $index) {
                <a class="cs-incident expanded-only" [href]="i.url" target="_blank" rel="noopener">{{ i.name }}</a>
              }
            </div>
          }
          <ul hlmSidebarMenu>
            <li hlmSidebarMenuItem>
              <button hlmSidebarMenuButton type="button" tooltip="Discussion temporaire sans projet, en mode plan" [isActive]="vm.inChat()" [attr.aria-current]="vm.inChat() ? 'page' : null" (click)="vm.newChat()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                <span>Discussion</span>
              </button>
            </li>
            @if (vm.chatError(); as err) { <li class="chat-error expanded-only" role="alert">{{ err }}</li> }
            <li hlmSidebarMenuItem>
              <a hlmSidebarMenuButton routerLink="/settings" [isActive]="vm.page() === '/settings'" [attr.aria-current]="vm.page() === '/settings' ? 'page' : null" tooltip="Réglages">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
                <span>Réglages</span>
              </a>
            </li>
          </ul>
        </div>
        <button hlmSidebarRail aria-label="Replier ou déplier la barre latérale"></button>
      </hlm-sidebar>

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
  `,
  styles: `
    .brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px; min-height: 32px; font-weight: 700; font-size: 16px; color: var(--text); }
    .logo { flex: none; color: var(--brand); }
    /* Mode icônes : seul ce qui sert à la navigation reste. */
    :host ::ng-deep [data-collapsible='icon'] .expanded-only, :host ::ng-deep [data-collapsible='icon'] .brand .name { display: none; }
    :host ::ng-deep [data-state='expanded'] .collapsed-only { display: none; }
    .pulse { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text-2); font-size: 12px; }
    .pulse { transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .pulse:hover { border-color: var(--line-strong); background: var(--hover); color: var(--text); }
    .pulse:active { background: var(--press); }
    .pulse-row { display: flex; justify-content: space-between; gap: 8px; }
    .limit { color: var(--text); font-weight: 600; }
    .session .lines { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .session .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--text); }
    .session .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--faint); }
    .session .sub.wait { color: var(--wait); }
    .session.with-badge { padding-inline-end: 56px; }
    .session.urgent { box-shadow: inset 2px 0 0 var(--wait); }
    /* Lignes de nav à angles droits : la barre d'état (gauche) reste droite, survol compris. */
    [hlmSidebarMenuButton] { border-radius: 0; }
    [hlmSidebarMenuButton]:hover, [hlmSidebarMenuButton][data-state='open'] { background: var(--hover); color: var(--text); }
    [hlmSidebarMenuButton]:active { background: var(--press); }
    /* Élément ouvert : bien visible dans les deux thèmes (le fond spartan par défaut se confond avec la sidebar). */
    [hlmSidebarMenuButton][data-active='true'] { background: var(--brand-bg); color: var(--text); box-shadow: inset 2px 0 0 var(--brand); }
    [hlmSidebarMenuButton][data-active='true']:hover { background: color-mix(in oklch, var(--brand-bg), var(--brand) 12%); }
    [hlmSidebarMenuButton][data-active='true'] svg { color: var(--brand); }
    .session[data-active='true'] .title { color: var(--brand); }
    .session[data-active='true'].urgent { box-shadow: inset 2px 0 0 var(--brand); }
    /* Icônes : jamais écrasées par le texte (sinon, replié, il ne reste qu'un trait et une lettre tronquée). */
    [hlmSidebarMenuButton] > svg { flex: none; }
    .initial { display: none; }
    /* Replié : chaque session = son initiale, avec le point d'état dans le coin ; le titre est dans le tooltip. */
    [data-collapsible='icon'] .session { position: relative; justify-content: center; padding: 0 !important; }
    [data-collapsible='icon'] .session .lines { display: none; }
    [data-collapsible='icon'] .session .initial { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--line-strong); font-size: 11px; font-weight: 600; color: var(--text-2); }
    [data-collapsible='icon'] .session .dot { position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; box-shadow: 0 0 0 2px var(--nav); }
    [data-collapsible='icon'] .session[data-active='true'] .initial { border-color: var(--brand); color: var(--brand); }
    [data-collapsible='icon'] .session.urgent .initial { border-color: var(--wait); color: var(--wait); }
    /* Replié : un trait sépare la nav des sessions, les libellés de groupe étant masqués. */
    [data-collapsible='icon'] [data-group] { border-top: 1px solid var(--line); }
    .pulse-dot { animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }
    .meta { color: var(--faint); font-size: 11px; }
    .spark { display: flex; align-items: flex-end; gap: 1px; height: 12px; }
    .spark i { width: 2px; height: 100%; border-radius: 1px; background: var(--brand); transform: scaleY(var(--h, 0)); transform-origin: bottom; transition: transform var(--dur) var(--ease); }
    .spark.stale i { background: var(--neutral); }
    .allow { color: var(--wait); }
    .allow { transition: background-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease); }
    .allow:hover { background: var(--wait-bg); color: var(--wait); }
    .allow:active { transform: scale(0.9); }
    .chevron { margin-inline-start: auto; transition: transform var(--dur) var(--ease); }
    .chevron.open { transform: rotate(90deg); }
    [data-group='waiting'] [hlmSidebarGroupLabel] { color: var(--wait); }
    .empty { padding: 4px 8px; font-size: 12px; color: var(--faint); }
    .claude-status { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px; font-size: 12px; }
    .claude-status a { border-radius: 4px; transition: color var(--dur-fast) var(--ease); }
    .cs-main { display: flex; align-items: center; gap: 8px; color: var(--text-2); }
    .cs-main:hover, .cs-incident:hover { color: var(--text); }
    .cs-incident { padding-inline-start: 16px; font-size: 11px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-ok { background: var(--ok); }
    .cs-err { background: var(--err); }
    .cs-neutral { background: var(--neutral); }
    [data-collapsible='icon'] .claude-status { align-items: center; padding-inline: 0; }
    .chat-error, .row-error { padding: 2px 8px; font-size: 11px; line-height: 1.4; color: var(--err); }
    .bell { display: flex; }
    /* Replié : logo puis cloche, l'un sous l'autre (la largeur ne tient qu'une icône). */
    [data-collapsible='icon'] .brand { flex-direction: column; padding-inline: 0; }
    /* Hauteur fixe = --chrome-top (styles.css). Collée en haut : le bouton du menu reste à portée en bas d'une longue page. */
    .mobile-bar { display: none; position: sticky; top: 0; z-index: 10; height: 52px; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--bg); font-weight: 600; }
    @media (max-width: 767px) { .mobile-bar { display: flex; } }
    /* Bandeau de version : hauteur fixe, ajoutée à --chrome-top pour que les vues pleine hauteur ne débordent pas. */
    .incompat { display: flex; align-items: center; gap: 8px; height: 36px; margin: 0; padding: 0 16px; border-bottom: 1px solid var(--err-line); background: var(--err-bg); color: var(--err); font-size: 12px; }
    .incompat svg { flex: none; }
    .incompat span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    main:has(> .incompat) { --chrome-top: 36px; }
    @media (max-width: 767px) { main:has(> .incompat) { --chrome-top: 88px; } }
    /* Daemon injoignable : même bandeau corail, sur deux lignes au plus (la commande ne se coupe pas). */
    .offline-bar { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 9px 16px; border-bottom: 1px solid var(--err-line); background: var(--err-bg); color: var(--err); font-size: 12px; line-height: 1.5; }
    .offline-bar svg { flex: none; margin-top: 2px; }
    .offline-bar p { min-width: 0; overflow-wrap: anywhere; }
    .offline-bar strong { font-weight: 600; }
    /* ponytail: hauteur estimée (2 lignes bureau, 4 sur téléphone) ; mesurer le bandeau si une vue pleine hauteur déborde encore. */
    main:has(> .offline-bar) { --chrome-top: 56px; }
    @media (max-width: 767px) { main:has(> .offline-bar) { --chrome-top: 140px; } }
    /* État figé : sessions et page passent en gris, l'ambre et le bleu ne font plus croire à un état vivant. */
    /* ::ng-deep : la page routée n'hérite pas de l'attribut de style du shell. */
    .offline [hlmSidebarContent], :host ::ng-deep .offline main > :not(.mobile-bar, .incompat, .offline-bar, router-outlet) { filter: grayscale(0.85); transition: filter var(--dur) var(--ease); }
  `,
})
export class App {
  protected readonly vm = inject(AppVm);
  /** Instancié ici : applique le thème mémorisé dès le démarrage (réglage dans /settings). */
  protected readonly theme = inject(ThemeService);
  /** Instancié ici : surveille les sessions dès le démarrage, même sans interaction. */
  protected readonly attention = inject(AttentionService);
  protected readonly f = f;
}
