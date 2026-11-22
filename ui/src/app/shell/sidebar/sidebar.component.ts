import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { AppVm } from '../../app.vm';
import * as f from '../../core/format';
import { Icon } from '../../core/icon.component';
import { NotificationCenterComponent } from '../notification-center/notification-center.component';

/**
 * Barre latérale spartan repliable (Cmd+B sur mac, ou icônes seules) : navigation, consommation en bref, sessions du jour
 * groupées par état pour les suivre d'un coup d'œil, statut de Claude. Vue seule, branchée sur le VM de la coque (AppVm).
 */
@Component({
  selector: 'app-sidebar',
  imports: [Icon, RouterLink, HlmKbd, HlmProgressImports, HlmSidebarImports, HlmTooltip, NotificationCenterComponent],
  template: `
    <hlm-sidebar collapsible="icon" variant="floating">
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
              <a hlmSidebarMenuButton routerLink="/" [isActive]="vm.page() === '/'" [attr.aria-current]="vm.page() === '/' ? 'page' : null" tooltip="Dashboard">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
                <span>Dashboard</span>
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
            <!-- Seul accès à la palette au doigt, et sous Linux depuis un terminal (Ctrl+F y reste au terminal). -->
            <li hlmSidebarMenuItem>
              <button hlmSidebarMenuButton type="button" closeMobileSidebarOnClick [tooltip]="'Rechercher dans les sessions (' + vm.searchKey + ')'" (click)="vm.openSearch()">
                <svg appIcon="search" width="16" height="16"></svg>
                <span>Rechercher</span>
              </button>
              <span hlmSidebarMenuBadge><kbd hlmKbd>{{ vm.searchKey }}</kbd></span>
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
                          <span class="mono">{{ f.usd(r.s.cost) }}</span>
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
            <a hlmSidebarMenuButton routerLink="/plugins" [isActive]="vm.page() === '/plugins'" [attr.aria-current]="vm.page() === '/plugins' ? 'page' : null" tooltip="Plugins de Vigie : des onglets en plus dans les sessions">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3v4M15 3v4M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" /></svg>
              <span>Plugins</span>
            </a>
          </li>
          <li hlmSidebarMenuItem>
            <a hlmSidebarMenuButton routerLink="/settings" [isActive]="vm.page() === '/settings'" [attr.aria-current]="vm.page() === '/settings' ? 'page' : null" tooltip="Réglages">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
              <span>Réglages</span>
            </a>
          </li>
          <li class="app-version expanded-only">Vigie v{{ vm.version }}</li>
        </ul>
      </div>
      <button hlmSidebarRail aria-label="Replier ou déplier la barre latérale"></button>
    </hlm-sidebar>
  `,
  styles: `
    /* Spartan place la barre directement dans l'enveloppe flex de la coque : l'hôte ne fait pas de boîte. */
    :host { display: contents; }
    /* Barre latérale en panneau détaché (décision 043) : marge autour (variante floating de spartan), rayon 12px, relief de repos ;
       en mobile, le panneau coulissant de spartan est inchangé. */
    :host ::ng-deep [data-variant='floating'] [data-slot='sidebar-inner'] { border: 1px solid var(--edge); border-radius: 12px; box-shadow: var(--elev-1); }
    .brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px; min-height: 32px; font-weight: 700; font-size: 16px; color: var(--text); }
    .logo { flex: none; color: var(--brand); }
    /* Mode icônes : seul ce qui sert à la navigation reste. */
    :host ::ng-deep [data-collapsible='icon'] .expanded-only, :host ::ng-deep [data-collapsible='icon'] .brand .name { display: none; }
    :host ::ng-deep [data-state='expanded'] .collapsed-only { display: none; }
    .pulse { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text-2); font-size: 12px; }
    .pulse { transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .pulse:hover { border-color: var(--line-strong); background: var(--hover); color: var(--text); }
    .pulse:active { background: var(--press); }
    .app-version { padding: 4px 8px; font-size: 11px; color: var(--faint); font-variant-numeric: tabular-nums; }
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
    [data-collapsible='icon'] .session .dot { position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; box-shadow: 0 0 0 2px var(--sidebar); }
    [data-collapsible='icon'] .session[data-active='true'] .initial { border-color: var(--brand); color: var(--brand); }
    [data-collapsible='icon'] .session.urgent .initial { border-color: var(--wait); color: var(--wait); }
    /* Replié : un trait sépare la nav des sessions, les libellés de groupe étant masqués. */
    [data-collapsible='icon'] [data-group] { border-top: 1px solid var(--line); }
    .pulse-dot { animation: pulse 1.6s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.35; } }
    @media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }
    .meta { color: var(--faint); font-size: 11px; }
    .spark { display: flex; align-items: flex-end; gap: 1px; height: 12px; }
    .spark i { width: 2px; height: 100%; border-radius: 1px; background: var(--data); transform: scaleY(var(--h, 0)); transform-origin: bottom; transition: transform var(--dur) var(--ease); }
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
  `,
})
export class SidebarComponent {
  protected readonly vm = inject(AppVm);
  protected readonly f = f;
}
