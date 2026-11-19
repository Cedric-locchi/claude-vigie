import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmPopoverImports } from '@spartan-ng/helm/popover';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import * as f from '../../../core/format';
import { TerminalComponent } from '../../terminal/terminal/terminal.component';
import { AgentPanelComponent } from '../agents/agent-panel/agent-panel.component';
import { AgentRowComponent } from '../agents/agent-row/agent-row.component';
import { SessionDiffComponent } from '../diff/session-diff.component';
import { SessionFilesComponent } from '../files/session-files.component';
import { SessionConfigComponent } from '../config/session-config.component';
import { SessionCostComponent } from '../cost/session-cost.component';
import { SessionLogComponent } from '../log/session-log.component';
import { SessionPageVm } from './session-page.vm';
import { PluginTabComponent } from '../plugin-tab/plugin-tab.component';
import { TimelineComponent } from '../timeline/timeline.component';
import { Icon } from '../../../core/icon.component';
import { WaitBarComponent } from '../agents/wait-bar/wait-bar.component';
import { PageComponent } from '../../../shell/page/page.component';

@Component({
  selector: 'app-session-page',
  imports: [PageComponent, Icon, RouterLink, HlmBadge, HlmButton, HlmCardImports, HlmEmptyImports, HlmPopoverImports, HlmProgressImports, HlmTabsImports, HlmToggleGroupImports, HlmTooltip, TerminalComponent, AgentRowComponent, AgentPanelComponent, SessionConfigComponent, SessionCostComponent, SessionDiffComponent, SessionFilesComponent, SessionLogComponent, PluginTabComponent, TimelineComponent, WaitBarComponent],
  providers: [SessionPageVm],
  host: { '(document:keydown)': 'vm.shortcut($event)' },
  template: `
    @let files = vm.view() === 'files';
    @if (vm.summary(); as s) {
      <!-- hlmTabs enveloppe le gabarit (display: contents) : la barre d'onglets et les panneaux, projetés, restent sous sa coupe. -->
      <div hlmTabs [tab]="vm.view()" (tabActivated)="vm.showView($any($event))">
      <app-page [mode]="vm.pageMode()" [class.files]="files">
      <div pageHeader class="flex flex-col gap-3.5">
        <header>
          <a hlmBtn variant="ghost" size="icon" routerLink="/" class="flex-none text-muted-foreground" aria-label="Retour au Dashboard"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg></a>
          <div class="head">
            <div class="title-row">
              <h1 [hlmTooltip]="s.title" [showDelay]="600">{{ s.title }}</h1>
              @if (vm.stateBadge(); as b) { <span hlmBadge [variant]="b.variant" class="flex-none">{{ b.label }}</span> }
              @if (vm.issues(); as n) { <span hlmBadge variant="issue" class="flex-none">{{ n }} agent{{ n > 1 ? 's' : '' }} en souci</span> }
              @if (vm.context(); as c) {
                <span class="ctx" [attr.data-level]="c.level" [hlmTooltip]="'Contexte de l’agent principal : ' + f.tokens(c.used) + ' sur ' + f.tokens(c.max) + ' tokens'">
                  <span class="ctx-bar" aria-hidden="true"><i [style.--p]="c.pct > 1 ? 1 : c.pct"></i></span>
                  <span class="mono">{{ f.tokens(c.used) }} / {{ f.tokens(c.max) }} · {{ f.pct(c.pct) }}</span>
                </span>
              }
            </div>
            <p class="small muted meta">
              {{ s.project }}@if (s.branch) { · <span class="mono">{{ s.branch }}</span> }@if (s.model) { · {{ s.model }} } · {{ f.duration(s.lastTs - s.firstTs) }} · <span class="mono">{{ f.tokens(s.tokens) }} tok</span>
            </p>
          </div>
          <div class="head-actions">
            @if (vm.canFiles()) {
              <button hlmBtn variant="outline" class="files-btn" [attr.aria-pressed]="files" [attr.aria-keyshortcuts]="vm.filesKey.aria" (click)="vm.toggleFiles()"
                [hlmTooltip]="(files ? 'Revenir à la vue précédente (' : 'Voir et retoucher les fichiers du projet (') + vm.filesKey.label + ')'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>Fichiers
              </button>
            }
            @if (vm.claudeTerminal()) {
              <button hlmBtn variant="outline" [class.compact-urgent]="vm.context()?.level === 'high'" [disabled]="!vm.canCompact()" (click)="vm.compact()"
                [hlmTooltip]="vm.canCompact() ? 'Tape /compact : Claude résume la conversation pour libérer le contexte' : 'Indisponible pendant une demande d’autorisation ou une question'">Compacter</button>
            }
            @if (vm.claudeTerminal()) {
              <button hlmBtn variant="outline" [disabled]="!vm.canInterrupt()" [hlmTooltip]="vm.canInterrupt() ? 'Arrête Claude au milieu de sa réponse' : 'Claude ne répond pas en ce moment'" (click)="vm.interrupt()">Interrompre</button>
            }
            <hlm-popover align="end" sideOffset="4">
              <button hlmPopoverTrigger hlmBtn variant="ghost" size="icon" class="text-muted-foreground" aria-label="Plus d'actions">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
              </button>
              <div hlmPopoverContent class="menu" *hlmPopoverPortal="let ctx">
                @if (!vm.isExternal() && vm.activeTab(); as tab) {
                  <button hlmBtn variant="ghost" class="w-full justify-start" (click)="ctx.close(); vm.detach(tab)">Détacher le terminal dans une fenêtre</button>
                }
                @if (vm.claudeTerminal() && !vm.isChat()) {
                  <button hlmBtn variant="ghost" class="w-full justify-start" [disabled]="!vm.canCompact()" (click)="ctx.close(); vm.end()">Terminer la session Claude</button>
                }
                <button hlmBtn variant="ghost" class="w-full justify-start hover:bg-err-bg hover:text-err" (click)="ctx.close(); vm.remove()">{{ vm.isChat() ? 'Quitter la discussion' : 'Supprimer la session de Vigie' }}</button>
              </div>
            </hlm-popover>
          </div>
        </header>

        <!-- Sous l'en-tête, quel que soit l'onglet : une session bloquée se voit et se débloque sans changer de vue. -->
        @if (vm.waitBar(); as w) {
          <app-wait-bar [bar]="w" [error]="vm.replyError()" (allow)="vm.allow()" (refuse)="vm.refuse()" (focusTerminal)="vm.goToTerminal()" />
        } @else if (vm.replyError(); as err) {
          <p class="reply-error small" role="alert">{{ err }}</p>
        }

        @if (vm.isExternal() && !files) {
          <div class="external small">
            <span>Session lancée hors de Vigie : suivie par son transcript, sans terminal ici.</span>
            <button hlmBtn [disabled]="vm.resuming()" (click)="vm.resume()">{{ vm.resuming() ? 'Reprise…' : 'Reprendre dans Vigie' }}</button>
            @if (vm.resumeError(); as err) { <span class="err">{{ err }}</span> }
          </div>
        }
      </div>

          <div hlmTabsList pageTabs variant="line" class="views-list" aria-label="Vues de la session" [hidden]="files">
            <button hlmTabsTrigger="workspace">
              {{ vm.isChat() ? 'Discussion' : vm.isExternal() ? 'Agents' : 'Terminal & agents' }}@if (vm.agentStats().waiting) { <span class="dot dot-waiting" aria-hidden="true"></span><span class="sr-only">, agent en attente</span> }
            </button>
            @if (vm.isChat()) {
              <button hlmTabsTrigger="usage">Consommation</button>
            } @else {
              <button hlmTabsTrigger="diff">Diff@if (vm.diffCount(); as n) { <span class="count mono" [attr.aria-label]="n + ' fichier' + (n > 1 ? 's' : '') + ' modifié' + (n > 1 ? 's' : '')">{{ n }}</span> }</button>
              @for (p of vm.plugins(); track p.id) {
                <button [hlmTabsTrigger]="'plugin:' + p.id">{{ p.name }}@if (p.badge) { <span class="count mono">{{ p.badge }}</span> }</button>
              }
              <button hlmTabsTrigger="history">Historique</button>
              <button hlmTabsTrigger="usage">Consommation</button>
              <button hlmTabsTrigger="config">Config</button>
            }
          </div>

        <div hlmTabsContent="workspace" class="workspace" [class.no-agents]="!vm.agentsOpen()" [class.is-external]="vm.isExternal()">
          @if (!vm.isExternal()) {
          <section class="term" aria-label="Terminal de la session">
              <div class="tabs" role="group" aria-label="Terminaux de la session">
                <!-- Les onglets défilent ; Agents reste toujours visible à droite. -->
                <div class="strip">
                @for (t of vm.terminals(); track t.id) {
                  <button type="button" class="tab" [attr.aria-current]="t.id === vm.activeTab() ? 'true' : null" (click)="vm.selectTab(t.id)">
                    @if (t.kind === 'claude') { <span class="dot" [class]="'dot-' + s.state" aria-hidden="true"></span> }
                    {{ t.title }}@if (t.exited) { <span class="faint"> (fermé)</span> }
                  </button>
                  @if (t.kind === 'shell') {
                    <button type="button" class="close" [attr.aria-label]="'Fermer le terminal ' + t.title" (click)="vm.closeTab(t.id)">
                      <svg appIcon="close" width="12" height="12"></svg>
                    </button>
                  }
                }
                <button type="button" class="icon" aria-label="Nouveau terminal dans ce dossier" (click)="vm.addShell()">
                  <svg appIcon="plus" width="14" height="14"></svg>
                </button>
                </div>
                <button type="button" class="toggle" [attr.aria-pressed]="vm.agentsOpen()" (click)="vm.toggleAgents()" hlmTooltip="Afficher ou masquer le panneau des agents">
                  Agents <span class="mono">{{ vm.agents().length }}</span>
                </button>
              </div>
              @for (t of vm.terminals(); track t.id) {
                <app-terminal [terminalId]="t.id" [focusTick]="vm.focusTick()" [active]="t.id === vm.activeTab() && vm.view() === 'workspace'" [hidden]="t.id !== vm.activeTab()" />
              }
              <!-- ponytail: pas de barre d'état PTY ni d'indicateur « hooks déconnectés » : le contrat ne dit pas si les hooks répondent. À ajouter si le daemon expose cet état. -->
          </section>
          }

          <!-- Une seule carte : l'en-tête (titre, filtres) et la liste, sous le même relief. -->
          <section class="agents" aria-labelledby="agents-title" [hidden]="!vm.agentsOpen() && !vm.isExternal()">
            <div class="agents-head">
            <h2 id="agents-title">Agents</h2>
            @if (vm.agents().length) {
              <div class="agent-filters" role="group" aria-label="Filtrer les agents par état">
                <button type="button" class="agent-filter" [attr.aria-pressed]="!vm.activeAgentFilter()" (click)="vm.filterAgents(null)">Tous</button>
                @for (f of vm.agentFilters(); track f.state) {
                  <button type="button" class="agent-filter" [attr.data-state]="f.state" [attr.aria-pressed]="vm.activeAgentFilter() === f.state" (click)="vm.filterAgents(f.state)">
                    <span [class]="'dot dot-' + f.state" aria-hidden="true"></span>{{ f.label }} <span class="mono">{{ f.count }}</span>
                  </button>
                }
              </div>
            }
            </div>
            <div class="agent-list">
            @for (a of vm.visibleAgents(); track a.id) {
              <app-agent-row [agent]="a" (open)="vm.showAgent(a.id)" />
            } @empty {
              <div class="empty flex flex-col items-start gap-2.5 p-3.5">
                @if (vm.claudeTerminal()) {
                  <p class="muted">Écris ta première demande dans le terminal.</p>
                  <button hlmBtn variant="outline" size="sm" (click)="vm.goToTerminal()">Aller au terminal</button>
                } @else {
                  <p class="muted">Aucun agent pour l'instant.</p>
                }
              </div>
            }
            </div>
          </section>
        </div>

        <div hlmTabsContent="history" class="panel history">
          @if (vm.view() === 'history') {
            <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" [spacing]="2" aria-label="Mode de l'historique" [value]="vm.historyMode()" (valueChange)="vm.showHistory($any($event))">
              <button hlmToggleGroupItem value="timeline">Chronologie</button>
              <button hlmToggleGroupItem value="log">Journal</button>
            </div>
            @if (vm.historyMode() === 'timeline') {
              <app-timeline [sessionId]="s.id" [lastTs]="s.lastTs" (openLog)="vm.openLog($event)" />
            } @else {
              <app-session-log [sessionId]="s.id" [lastTs]="s.lastTs" [query]="vm.logQuery()" />
            }
          }
        </div>

        <div hlmTabsContent="diff" class="panel">
          @if (vm.view() === 'diff' || vm.unsaved()) { <app-session-diff [(unsaved)]="vm.unsaved" [sessionId]="s.id" [lastTs]="s.lastTs" [idle]="vm.idle()" [canWorktree]="vm.canCompact()" (worktree)="vm.enterWorktree($event)" /> }
        </div>

        <!-- Pas d'onglet : la vue s'ouvre par le bouton Fichiers de l'en-tête, la liste d'onglets est alors masquée. -->
        <div hlmTabsContent="files" class="panel files-panel" aria-label="Fichiers du projet">
          @if (vm.view() === 'files') { <app-session-files [sessionId]="s.id" [idle]="vm.idle()" /> }
        </div>

        @for (p of vm.plugins(); track p.id) {
          <div [hlmTabsContent]="'plugin:' + p.id" class="panel">
            @if (vm.view() === 'plugin:' + p.id) { <app-plugin-tab [sessionId]="s.id" [cwd]="s.cwd" [pluginId]="p.id" (opened)="vm.selectTab($event)" (refresh)="vm.reloadTabs()" /> }
          </div>
        }

        <div hlmTabsContent="config" class="panel">
          @if (vm.view() === 'config') { <app-session-config [sessionId]="s.id" [cwd]="s.cwd" /> }
        </div>

        <div hlmTabsContent="usage" class="panel">
          @if (vm.view() === 'usage') {
            @if (vm.usage(); as u) {
              <div class="flex flex-col gap-3.5">
                <section hlmCard class="usage-card" aria-label="Tokens de la session">
                  <div class="stats">
                    <div class="lead"><span class="small muted">Depuis le cache</span><span class="mono big">{{ f.pct(u.cacheRate) }}</span></div>
                    <dl class="small flex flex-col gap-0.5 basis-64">
                      <div class="flex justify-between gap-4"><dt class="muted">Total</dt><dd class="mono text-right">{{ f.tokens(u.total) }} tok</dd></div>
                      <div class="flex justify-between gap-4"><dt class="muted">Contexte actuel</dt><dd class="mono text-right">{{ f.tokens(u.context) }} tok</dd></div>
                      <div class="flex justify-between gap-4"><dt class="muted">Appels API</dt><dd class="mono text-right">{{ u.calls }}</dd></div>
                    </dl>
                  </div>
                  <div class="stack" aria-hidden="true">
                    @for (p of u.parts; track p.key) { <span [class]="p.key" [style.width.%]="p.share * 100"></span> }
                  </div>
                  <div class="legend small">
                    @for (p of u.parts; track p.key) {
                      <span><i [class]="p.key"></i>{{ p.label }} <span class="mono muted">{{ f.tokens(p.tokens) }} · {{ f.pct(p.share) }}</span></span>
                    }
                  </div>
                  @if (u.cacheRate < 0.5) {
                    <p class="small muted">Moins de la moitié de l'entrée vient du cache : la session recharge beaucoup de contexte.</p>
                  }
                </section>

                <section hlmCard class="usage-card" aria-label="Tokens par agent">
                  <h3 hlmCardTitle>Par agent</h3>
                  @for (a of u.agents; track a.id) {
                    <div class="agent-row">
                      <div class="row small"><span>{{ a.name }}@if (a.sub) { <span class="faint"> · sous-agent</span> }</span><span class="mono">{{ f.tokens(a.tokens) }} tok · {{ a.cost != null ? f.usd(a.cost) : '—' }}</span></div>
                      <hlm-progress [value]="a.width" aria-hidden="true"><hlm-progress-indicator /></hlm-progress>
                    </div>
                  }
                </section>

                <app-session-cost [sessionId]="s.id" [state]="s.state" [lastTs]="s.lastTs" [agents]="vm.agents()" />
              </div>
            } @else { <div hlmEmpty><div hlmEmptyHeader><div hlmEmptyDescription>Pas encore de consommation pour cette session.</div></div></div> }
          }
        </div>
      </app-page>
      </div>

      <app-agent-panel [agent]="vm.openAgent()" [canAnswer]="!vm.openAgent()?.sub && !!vm.claudeTerminal()" [error]="vm.replyError()" (closed)="vm.showAgent(null)" (allow)="vm.allow()" (refuse)="vm.refuse()" (focusTerminal)="vm.goToTerminal()" />
    } @else {
      <app-page>
        @if (vm.notFound()) {
          <p class="muted">{{ vm.outdated() ? 'Session illisible : le daemon est-il à jour ? (redémarre-le après une mise à jour)' : 'Session introuvable.' }} <a routerLink="/">Retour au Dashboard</a></p>
        } @else {
          <p class="muted">Chargement…</p>
        }
      </app-page>
    }
  `,
  styles: `
    /* Gabarit (shell/page) : mode choisi par vue dans le VM ; ici, seulement l'espacement de la page de session. */
    [hlmTabs] { display: contents; }
    app-page { --page-pt: 16px; --page-pb: 24px; --page-gap: 14px; }
    header { display: flex; align-items: center; gap: 14px; }
    .head { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .ctx { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); }
    .ctx-bar { width: 48px; height: 4px; background: var(--line); overflow: hidden; }
    .ctx-bar i { display: block; height: 100%; background: var(--data); transform: scaleX(var(--p, 0)); transform-origin: left; transition: transform var(--dur) var(--ease); }
    .ctx[data-level='mid'] { color: var(--text-2); }
    .ctx[data-level='high'] { color: var(--err); }
    .ctx[data-level='high'] .ctx-bar i { background: var(--err); }
    .compact-urgent:not(:disabled) { border-color: var(--err-line); color: var(--err); }
    h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .head-actions { display: flex; gap: 8px; flex: none; }
    /* Vue Fichiers : ses trois panneaux (rail, arbre, éditeur) se posent sur le fond pointillé, à l'écart régulier des autres vues (décision 043). */
    .views-list { border-bottom: 1px solid var(--line); }
    /* Un panneau = la vue ouverte : en mode fill il prend la hauteur du corps et la passe à ses colonnes. */
    .panel { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
    /* Le terminal est la zone principale : il prend toute la hauteur restante, les agents défilent à côté. */
    .workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: minmax(0, 1fr); gap: 14px; }
    .workspace.no-agents { grid-template-columns: minmax(0, 1fr); }
    /* Terminal et agents : deux cartes au même relief, en-tête compris. */
    .term, .agents { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-radius: 12px; box-shadow: var(--elev-1); overflow: hidden; }
    .term { border: 1px solid var(--line-strong); background: var(--bg-deep); }
    .term app-terminal { flex: 1; min-height: 0; }
    .tabs { display: flex; align-items: stretch; background: var(--nav); border-bottom: 1px solid var(--surface-2); }
    .tabs button { flex: none; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; border: 0; border-right: 1px solid var(--surface-2); background: transparent; color: var(--text-muted); font-family: var(--mono); font-size: 12px; cursor: pointer; transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .tabs button:hover { background: var(--hover); color: var(--text); }
    .tabs button:active { background: var(--press); }
    .tabs button:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    /* Onglet actif : un liseré de marque, comme un onglet d'éditeur. */
    .tabs .tab[aria-current='true'] { background: var(--bg-deep); color: var(--text); box-shadow: inset 0 2px 0 var(--brand); }
    /* Croix collée à son onglet : l'onglet perd sa bordure droite au profit de celle de la croix. */
    .tabs button:has(+ .close) { border-right: 0; padding-right: 6px; }
    .tabs .close { width: 26px; padding: 0; justify-content: center; }
    .tabs .tab[aria-current='true'] + .close { background: var(--bg-deep); }
    .tabs .close:hover { background: var(--err-bg); color: var(--err); }
    .tabs .icon { width: 36px; padding: 0; justify-content: center; border-right: 0; }
    .tabs .toggle { border-right: 0; border-left: 1px solid var(--surface-2); font-family: inherit; }
    .tabs .toggle[aria-pressed='true'] { color: var(--text); }
    .count { margin-left: 6px; font-size: 11px; color: var(--faint); }
    .menu { width: auto; padding: 4px; gap: 0; }
    .strip { flex: 1; min-width: 0; display: flex; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
    @media (pointer: coarse) {
      .tabs button { height: 44px; }
      .tabs .close { width: 40px; }
    }
    .external { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text-muted); }
    .external .err { flex-basis: 100%; color: var(--err); }
    .reply-error { color: var(--err); }
    /* La liste défile sous un titre fixe : des lignes séparées par des filets, dans un seul panneau. */
    .agent-list { flex: 1; min-height: 0; overflow-y: auto; }
    /* Session externe : pas de terminal, la même liste en pleine largeur ; le corps défile (mode scroll). */
    .workspace.is-external { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; }
    .is-external .agent-list { overflow: visible; }
    .history { gap: 12px; }
    .agents { border: 1px solid var(--edge); background: var(--surface); }
    .agents-head { flex: none; display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .agent-filters { display: flex; flex-wrap: wrap; gap: 6px; }
    .agent-filter {
      display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--line); background: transparent;
      color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    :is(.agent-filter, .tabs .toggle) .mono { color: var(--faint); font-size: 11px; }
    .agent-filter:hover { background: var(--hover); border-color: var(--line-strong); color: var(--text); }
    .agent-filter:active { background: var(--press); }
    :is(.agent-filter, .files-btn)[aria-pressed='true'] { border-color: var(--brand); background: var(--brand-bg); color: var(--text); }
    .agent-filter[aria-pressed='true'] .mono { color: var(--brand); }
    h2 { font-size: 15px; font-weight: 600; }
    .usage-card { padding: 16px 18px; gap: 14px; }
    .stats { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 40px; }
    .lead { display: flex; flex-direction: column; gap: 4px; }
    .big { font-size: 22px; font-weight: 500; }
    .stack { display: flex; height: 12px; border-radius: 4px; overflow: hidden; background: var(--line); }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 10px; height: 10px; border-radius: 2px; }
    .cache-read { background: var(--read); }
    .cache-write { background: var(--data); }
    .input { background: var(--text-muted); }
    .output { background: var(--brand); }
    .agent-row { display: flex; flex-direction: column; gap: 6px; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    /* Fenêtre étroite : terminal au-dessus, agents dessous, chacun dans sa part de la hauteur (aucun défilement du corps). */
    @media (max-width: 1100px) {
      .workspace { grid-template-columns: minmax(0, 1fr); }
    }
    @media (min-width: 721px) and (max-width: 1100px) { .workspace:not(.no-agents, .is-external) { grid-template-rows: minmax(0, 3fr) minmax(0, 2fr); } }
    /* Téléphone : le titre garde sa ligne, les actions passent dessous et vont à la ligne si besoin. */
    @media (max-width: 720px) {
      /* Seul le document défile (gabarit) : le terminal garde une hauteur propre, la liste des agents s'allonge. */
      .term { height: max(480px, calc(100dvh - var(--chrome-top) - 140px)); }
      .workspace { grid-template-rows: none; }
      .agent-list { overflow: visible; }
      header { flex-wrap: wrap; align-items: flex-start; }
      .head { flex-basis: calc(100% - 50px); }
      .title-row { flex-wrap: wrap; }
      h1 { max-width: 100%; }
      /* Six ou sept vues ne tiennent pas : la barre défile. Le padding garde visible l'indicateur d'onglet actif (2px sous la barre). */
      .views-list > * { flex: none; }
      /* Le gabarit la fait coller sous la barre mobile ; pleine largeur, 41px = sa part de --sticky-top (shell/page). */
      .views-list { width: 100%; height: 41px; justify-content: flex-start; overflow-x: auto; scrollbar-width: none; padding-bottom: 5px; }
      .head-actions { flex: 1 1 100%; flex-wrap: wrap; }
    }
  `,
})
export class SessionPageComponent {
  readonly id = input.required<string>();
  /** Public : lu par le garde de sortie de la route (discussion). */
  readonly vm = inject(SessionPageVm);
  protected readonly f = f;

  constructor() {
    this.vm.connect(this.id);
  }
}
