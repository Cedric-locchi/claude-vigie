import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { tokens } from '../../../core/format';
import { ConfigPermissionsComponent } from './permissions/config-permissions.component';
import { SCOPE_HINT, SCOPE_LABEL } from './config-rules';
import { Icon } from '../../../core/icon.component';
import { SessionConfigVm } from './session-config.vm';

const LEVELS = { error: { label: 'Erreur', variant: 'issue' }, warning: { label: 'À revoir', variant: 'outline' }, info: { label: 'Info', variant: 'secondary' } } as const;
const COST_HINT = {
  instructions: 'Estimation (~4 octets par token, imports non compris) : le fichier est chargé en entier au début de chaque session.',
  other: "Estimation (~4 caractères par token) : seuls le nom et la description restent en contexte, le contenu n'est chargé qu'à l'usage.",
};

/**
 * Onglet Config : la configuration effective de la session. Une ligne d'état en haut, les rubriques à gauche,
 * la rubrique choisie à droite avec la légende des portées (ordre de priorité, sert de filtre). Lecture seule.
 */
@Component({
  selector: 'app-session-config',
  imports: [Icon, NgTemplateOutlet, HlmBadge, HlmButton, HlmTooltip, ConfigPermissionsComponent],
  providers: [SessionConfigVm],
  template: `
    <div class="config-head">
      <div class="title">
        <h2>Configuration effective</h2>
        <span class="where mono small faint" [hlmTooltip]="'Configuration Claude Code appliquée à ' + (vm.config()?.cwd ?? cwd())">{{ vm.config()?.cwd ?? cwd() }}</span>
      </div>
      <div class="actions">
        @let n = vm.counts();
        <span class="health small" role="status" [attr.data-state]="n.error ? 'error' : n.warning ? 'warning' : 'ok'">
          <span class="health-dot" aria-hidden="true"></span>
          @if (!vm.config()) {
            Lecture de la configuration…
          } @else if (n.error || n.warning) {
            @if (n.error) { {{ n.error }} erreur{{ n.error > 1 ? 's' : '' }} }@if (n.error && n.warning) { · }@if (n.warning) { {{ n.warning }} à revoir }
          } @else {
            Tout est en ordre
          }
        </span>
        <button hlmBtn variant="ghost" size="sm" (click)="vm.reload()">Revérifier</button>
        <button hlmBtn variant="outline" size="sm" [disabled]="vm.auditing()" (click)="vm.audit()" hlmTooltip="Ouvre une nouvelle session Claude en mode plan (lecture seule) qui passe toute la configuration en revue">
          {{ vm.auditing() ? 'Lancement…' : 'Audit approfondi' }}
        </button>
      </div>
    </div>
    @if (vm.auditError(); as err) { <p class="small text-err" role="alert">{{ err }}</p> }

    @if (vm.failed()) {
      <p class="small text-err" role="alert">Configuration indisponible : le daemon est-il à jour ? (redémarre-le après une mise à jour)</p>
    } @else if (vm.current(); as cur) {
      <div class="body">
        <nav class="nav" aria-label="Rubriques de la configuration">
          @for (s of vm.sections(); track s.key) {
            <button type="button" class="nav-item" [class.zero]="!s.count" [attr.aria-current]="vm.section() === s.key ? 'page' : null" (click)="vm.select(s.key)">
              <span>{{ s.label }}</span>
              @if (s.errors) { <span class="pip error"><span class="sr-only">{{ s.errors }} erreur(s)</span></span> }
              @else if (s.warnings) { <span class="pip warning"><span class="sr-only">{{ s.warnings }} à revoir</span></span> }
              <span class="count">{{ s.count }}</span>
            </button>
          }
        </nav>

        <section class="pane" [attr.aria-label]="cur.label">
          <header class="pane-head">
            <div>
              <h3>{{ cur.label }}</h3>
              <p class="small muted">{{ cur.hint }}</p>
            </div>
            @if (vm.scopes().length) {
              <div class="scopes" role="group" aria-label="Portées, de la plus prioritaire à la moins prioritaire ; filtre">
                @for (sc of vm.scopes(); track sc.scope; let last = $last) {
                  <button type="button" class="scope" [attr.aria-pressed]="vm.scope() === sc.scope" [hlmTooltip]="scopeHint[sc.scope]" (click)="vm.setScope(sc.scope)">
                    {{ scopeLabel[sc.scope] }} <span class="mono faint">{{ sc.count }}</span>
                  </button>
                  @if (!last) { <svg appIcon="chevron" class="sep"></svg> }
                }
              </div>
            }
          </header>

          @for (k of cur.general; track $index) {
            <div class="issue" [attr.data-level]="k.level">
              <span hlmBadge [variant]="levels[k.level].variant">{{ levels[k.level].label }}</span>
              <span class="issue-text">
                @if (cur.key === 'issues') { <span class="muted">{{ k.area }} · </span> }{{ k.message }}
                @if (k.path) { <span class="mono small faint path">{{ k.path }}</span> }
              </span>
            </div>
          }

          @if (cur.key === 'issues') {
            <!-- Rien d'autre : les problèmes ci-dessus. -->
          } @else if (!cur.rows.length) {
            <p class="empty">{{ vm.scope() ? 'Rien dans la portée ' + scopeLabel[vm.scope()!] + '.' : cur.empty }}</p>
          } @else if (cur.key === 'permissions') {
            <app-config-permissions />
          } @else if (cur.key === 'instructions') {
            @for (r of cur.rows; track r.id) {
              <article class="doc">
                <ng-container [ngTemplateOutlet]="line" [ngTemplateOutletContext]="{ $implicit: r }" />
                @if (r.imports?.length) {
                  <ul class="imports" aria-label="Imports">
                    @for (m of r.imports; track m.ref) {
                      <li class="mono small" [class.text-err]="!m.ok">&#64;{{ m.ref }}@if (!m.ok) { <span> · introuvable</span> }</li>
                    }
                  </ul>
                }
                @for (k of r.issues; track $index) {
                  <p class="row-issue small" [attr.data-level]="k.level"><span hlmBadge [variant]="levels[k.level].variant">{{ levels[k.level].label }}</span> {{ k.message }}</p>
                }
                @if (r.html !== undefined) {
                  @let full = vm.expanded().has(r.id);
                  <!-- [innerHTML] passe par le sanitizer d'Angular (scripts et handlers retirés). -->
                  <div class="markdown doc-body" [class.clamped]="r.long && !full" [innerHTML]="r.html"></div>
                  @if (r.long) {
                    <button hlmBtn variant="ghost" size="sm" class="more" [attr.aria-expanded]="full" (click)="vm.toggle(r.id, !full)">{{ full ? 'Replier' : 'Tout afficher' }}</button>
                  }
                }
              </article>
            }
          } @else {
            <ul class="rows">
              @for (r of cur.rows; track r.id) {
                <li class="row" [class.has-issue]="r.issues.length">
                  @if (r.body !== undefined) {
                    <!-- Accordéon natif : replié, le nom seul ; déplié, description, outils puis markdown rendu. -->
                    <details [open]="!!r.html" (toggle)="vm.toggle(r.id, $any($event).newState === 'open')">
                      <summary><ng-container [ngTemplateOutlet]="line" [ngTemplateOutletContext]="{ $implicit: r }" /></summary>
                      @if (r.html) {
                        <ng-container [ngTemplateOutlet]="extra" [ngTemplateOutletContext]="{ $implicit: r }" />
                        @if (r.body.trim()) {
                          <div class="markdown row-body" [innerHTML]="r.html"></div>
                        } @else {
                          <p class="empty">Fichier vide en dehors de son en-tête.</p>
                        }
                      }
                    </details>
                  } @else {
                    <ng-container [ngTemplateOutlet]="line" [ngTemplateOutletContext]="{ $implicit: r }" />
                    <ng-container [ngTemplateOutlet]="extra" [ngTemplateOutletContext]="{ $implicit: r }" />
                  }
                  @for (k of r.issues; track $index) {
                    <p class="row-issue small" [attr.data-level]="k.level"><span hlmBadge [variant]="levels[k.level].variant">{{ levels[k.level].label }}</span> {{ k.message }}</p>
                  }
                </li>
              }
            </ul>
          }
          <ng-template #line let-r>
            <div class="row-line">
              <span class="row-title" [class.mono]="r.mono" [title]="r.title"><span class="head">{{ r.parts[0] }}</span><span>{{ r.parts[1] }}</span></span>
              @if (r.scope; as sc) { <span hlmBadge variant="outline" [hlmTooltip]="$any(scopeHint)[sc]">{{ $any(scopeLabel)[sc] }}</span> }
              <span class="row-meta small faint">
                @if (r.meta) { <span>{{ r.meta }}</span> }
                @if (r.tokens !== undefined) {
                  <span class="mono" [hlmTooltip]="cur.key === 'instructions' ? costHint.instructions : costHint.other">~{{ tok(r.tokens) }} tok<span class="sr-only"> (estimation)</span></span>
                }
              </span>
            </div>
          </ng-template>
          <ng-template #extra let-r>
            @if (r.descHtml) {
              <div class="markdown row-desc-md" [innerHTML]="r.descHtml"></div>
            } @else if (r.description) {
              <p class="row-desc small">{{ r.description }}</p>
            }
            @if (r.missing) { <p class="row-desc small text-err">{{ r.missing }}</p> }
            @if (r.code) { <code class="row-code small">{{ r.code }}</code> }
            @if (r.tools !== undefined) {
              <div class="tools small" aria-label="Outils de l'agent">
                <span class="faint">Outils</span>
                @for (t of r.tools ?? []; track t) { <span class="tool mono">{{ t }}</span> } @empty { <span class="tool">Tous (hérités)</span> }
              </div>
            }
          </ng-template>
        </section>
      </div>
    }
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
    .config-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
    .title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    h2 { margin: 0; flex: none; font-size: 15px; font-weight: 600; }
    .where { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; align-items: center; gap: 6px; }
    .health { display: flex; align-items: center; gap: 8px; margin-inline-end: 6px; color: var(--text-2); }
    .health-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-bg); }
    .health[data-state='warning'] .health-dot { background: var(--text-muted); box-shadow: 0 0 0 3px var(--surface-2); }
    .health[data-state='error'] .health-dot { background: var(--err); box-shadow: 0 0 0 3px var(--err-bg); }

    .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr); border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
    .nav { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-right: 1px solid var(--line); overflow-y: auto; }
    .nav-item {
      display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
      color: var(--text-2); font: inherit; font-size: 13px; text-align: start;
      transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .nav-item.zero { color: var(--faint); }
    .nav-item:hover { background: var(--hover); color: var(--text); }
    .nav-item:active { background: var(--press); }
    .nav-item[aria-current='page'] { background: var(--brand-bg); color: var(--text); font-weight: 500; box-shadow: inset 2px 0 0 var(--brand); }
    :is(.nav-item, .scope):focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
    .nav-item > span:first-child { margin-inline-end: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { font-family: var(--mono); font-size: 11px; color: var(--faint); font-weight: 400; }
    .count { min-width: 3ch; text-align: end; }
    .pip { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .pip.error { background: var(--err); }
    .pip.warning { background: var(--text-muted); }

    .pane { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 20px 24px; display: flex; flex-direction: column; gap: 12px; }
    .pane-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 16px; }
    h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .pane-head p { margin: 2px 0 0; }
    .scopes { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
    .scope {
      height: 26px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-2); font: inherit; font-size: 12px;
      transition: background-color var(--dur-fast) var(--ease);
    }
    .scope:hover { background: var(--hover); }
    .scope[aria-pressed='true'] { background: var(--brand-bg); border-color: var(--brand); color: var(--text); }
    .sep { width: 12px; height: 12px; fill: none; stroke: var(--faint); stroke-width: 2; }

    .issue { display: flex; align-items: baseline; gap: 10px; padding: 10px 12px; border-radius: 8px; background: var(--bg); }
    .issue[data-level='error'] { background: var(--err-bg); }
    .issue[data-level='warning'] { background: var(--surface-2); }
    .issue-text { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
    .path { display: block; margin-top: 2px; }
    .rows, .imports { margin: 0; padding: 0; list-style: none; }
    .row { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-top: 1px solid var(--line); }
    .row:first-child { border-top: 0; }
    .row-line { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 22px; }
    .row-title { display: flex; min-width: 0; white-space: nowrap; font-weight: 500; }
    .head { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .row-title.mono { font-size: 13px; }
    .row-meta { margin-inline-start: auto; flex: none; display: flex; gap: 10px; }
    .row-desc { margin: 0; color: var(--text-2); line-height: 1.45; }
    .row-code { font-family: var(--mono); color: var(--text-muted); overflow-wrap: anywhere; }
    summary { display: flex; flex-direction: column; gap: 4px; list-style: none; cursor: pointer; border-radius: 6px; }
    summary::-webkit-details-marker { display: none; }
    summary:hover .row-title { color: var(--brand); }
    summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    summary .row-title::before {
      content: ''; flex: none; width: 12px; height: 12px; margin: auto 4px auto 0; background: var(--faint);
      mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='m9 6 6 6-6 6'/%3E%3C/svg%3E") center / contain no-repeat;
      transition: transform var(--dur-fast) var(--ease);
    }
    details[open] summary .row-title::before { transform: rotate(90deg); }
    details[open] > :not(summary) { margin-top: 6px; }
    .row-desc-md > :last-child { margin-bottom: 0; }
    .tools, .imports { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
    .tool, .imports li { padding: 1px 7px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--text-2); font-size: 11px; }
    .imports li.text-err { border-color: var(--err-line); color: var(--err); }
    .row-body, .doc-body { padding: 12px 14px; border-radius: 8px; background: var(--bg); }
    .doc { display: flex; flex-direction: column; gap: 8px; }
    .doc + .doc { padding-top: 14px; border-top: 1px solid var(--line); }
    /* Aperçu d'environ 12 lignes, fondu en bas pour dire « il y a la suite ». */
    .clamped { max-height: 20em; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent); }
    .more { align-self: flex-start; }
    .row-issue { display: flex; align-items: baseline; gap: 8px; margin: 2px 0 0; }
    .row-issue[data-level='error'] { color: var(--err); }
    .row-issue[data-level='warning'] { color: var(--text-2); }
    .empty { margin: 0; padding: 8px 0; font-size: 13px; color: var(--faint); }

    @media (max-width: 820px) {
      .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .nav { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); }
      .nav-item { flex: none; }
      .pane { padding: 14px; }
    }
  `,
})
export class SessionConfigComponent {
  readonly sessionId = input.required<string>();
  readonly cwd = input.required<string>();

  protected readonly vm = inject(SessionConfigVm);
  protected readonly levels = LEVELS;
  protected readonly scopeLabel = SCOPE_LABEL;
  protected readonly scopeHint = SCOPE_HINT;
  protected readonly costHint = COST_HINT;
  protected readonly tok = tokens;

  constructor() {
    this.vm.connect(this.sessionId, this.cwd);
  }
}
