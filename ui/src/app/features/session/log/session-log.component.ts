import { Component, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { HlmBadge, BadgeVariants } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { LogKind } from '../../../core/models';
import { Icon } from '../../../core/icon.component';
import { SessionLogVm } from './session-log.vm';

const BADGES: Record<LogKind, BadgeVariants['variant']> = {
  prompt: 'default', assistant: 'secondary', thinking: 'outline', tool: 'running', result: 'secondary', error: 'issue', system: 'ghost',
};

/** Onglet Journal : tout ce qui s'est passé dans la session (agents compris), avec recherche. */
@Component({
  selector: 'app-session-log',
  imports: [Icon, HlmBadge, HlmButton, HlmEmptyImports, HlmInputGroupImports, HlmSelectImports, HlmToggleGroupImports],
  providers: [SessionLogVm],
  template: `
    <div class="tools">
      <div hlmInputGroup class="search">
        <input hlmInputGroupInput type="search" aria-label="Rechercher dans le journal" placeholder="Rechercher dans la session…" [value]="vm.query()" (input)="vm.setQuery($any($event.target).value)" />
        <div hlmInputGroupAddon><svg appIcon="search" width="15" height="15"></svg></div>
      </div>
      @let c = vm.counts();
      <div hlmToggleGroup type="single" [nullable]="false" variant="outline" size="sm" aria-label="Type d'événement" [value]="vm.filter()" (valueChange)="vm.setFilter($any($event))">
        <button hlmToggleGroupItem value="all">Tout <span class="n">{{ c.all }}</span></button>
        <button hlmToggleGroupItem value="talk">Échanges <span class="n">{{ c.talk }}</span></button>
        <button hlmToggleGroupItem value="tools">Outils <span class="n">{{ c.tools }}</span></button>
        <button hlmToggleGroupItem value="errors" [class.has-errors]="c.errors">Erreurs <span class="n">{{ c.errors }}</span></button>
        <button hlmToggleGroupItem value="system">Système <span class="n">{{ c.system }}</span></button>
      </div>
      @if (vm.agents().length > 1) {
        <hlm-select class="agent" [value]="vm.agent() ?? ''" (valueChange)="vm.setAgent($any($event))" [itemToString]="agentLabel">
          <hlm-select-trigger size="sm" buttonId="log-agent" aria-label="Agent"><hlm-select-value /></hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            <hlm-select-item value="">Tous les agents</hlm-select-item>
            @for (a of vm.agents(); track a) { <hlm-select-item [value]="a">{{ a }}</hlm-select-item> }
          </hlm-select-content>
        </hlm-select>
      }
      <span class="total small faint" aria-live="polite">{{ vm.matches().length }} ligne{{ vm.matches().length > 1 ? 's' : '' }}</span>
    </div>

    @if (vm.error(); as err) { <p class="small text-err" role="alert">{{ err }}</p> }

    @if (vm.loading()) {
      <p class="small faint">Chargement du journal…</p>
    } @else {
      <div #scroller class="scroller" tabindex="-1">
      <ol class="entries panel">
        @for (e of vm.visible(); track e.id) {
          <li class="entry" [attr.data-kind]="e.kind">
            <div class="meta">
              <time class="mono">{{ e.time }}</time>
              <span hlmBadge [variant]="badge(e.kind)">{{ e.label }}</span>
              @if (e.sub) { <span class="agent-name small">{{ e.agent }}</span> }
              <span class="title">@for (p of e.titleParts; track $index) { @if (p.hit) { <mark>{{ p.text }}</mark> } @else { {{ p.text }} } }</span>
            </div>
            @if (e.text) {
              <!-- Sans blanc entre les blocs : un <pre> garde ceux du gabarit (ils s'ajouteraient au texte de la ligne). -->
              <pre class="text" [class.clamp]="e.long && !e.open">@for (p of e.textParts; track $index) {@if (p.hit) {<mark>{{ p.text }}</mark>} @else {{{ p.text }}}}</pre>
              @if (e.long || e.truncated) {
                <div class="foot">
                  @if (e.long) { <button hlmBtn variant="link" size="xs" (click)="vm.toggle(e.id)">{{ e.open ? 'Réduire' : 'Tout afficher' }}</button> }
                  @if (e.truncated) { <span class="small faint">Texte coupé à 4000 caractères.</span> }
                </div>
              }
            }
          </li>
        } @empty {
          <div hlmEmpty>
            <div hlmEmptyHeader>
              <div hlmEmptyTitle>{{ vm.query() ? 'Rien ne correspond' : 'Journal vide' }}</div>
              <div hlmEmptyDescription>{{ vm.query() ? 'Essaie un autre mot, ou élargis le filtre.' : "Rien n'a encore été écrit dans cette session." }}</div>
            </div>
          </div>
        }
      </ol>
      @if (vm.hasMore()) {
        <button hlmBtn variant="outline" size="sm" class="more" (click)="vm.more()">Afficher 200 lignes de plus ({{ vm.matches().length - vm.visible().length }} restantes)</button>
      }
      </div>
    }
  `,
  styles: `
    :host { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
    .tools { flex: none; }
    /* Seule la liste défile : la recherche et les filtres restent à l'écran. */
    .scroller { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 16px; outline: none; }
    .scroller .entries { flex: none; }
    /* Téléphone : le document défile seul, la liste s'allonge. */
    @media (max-width: 720px) { .scroller { overflow: visible; } }
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .search { width: 320px; max-width: 100%; }
    .n { margin-inline-start: 4px; font-family: var(--mono); font-size: 11px; color: var(--faint); }
    .has-errors .n { color: var(--err); }
    .agent { width: 200px; }
    .total { margin-inline-start: auto; }
    .entries { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; overflow: hidden; }
    .entry { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--line); transition: background-color var(--dur-fast) var(--ease); }
    .entry:last-child { border-bottom: 0; }
    .entry:hover { background: var(--hover); }
    .entry[data-kind='error'] { box-shadow: inset 3px 0 0 var(--err); }
    .entry[data-kind='prompt'] { box-shadow: inset 3px 0 0 var(--brand); }
    .meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
    time { flex: none; font-size: 11px; color: var(--faint); }
    .agent-name { flex: none; color: var(--text-2); }
    .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; color: var(--text); }
    .text { margin: 0; font-family: var(--mono); font-size: 12px; line-height: 1.5; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
    .entry[data-kind='thinking'] .text, .entry[data-kind='system'] .text { color: var(--text-muted); }
    .entry[data-kind='error'] .text { color: var(--err); }
    .text.clamp { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
    .foot { display: flex; align-items: center; gap: 10px; }
    mark { border-radius: 2px; background: color-mix(in oklch, var(--brand) 30%, transparent); color: var(--text); }
    .more { align-self: center; }
  `,
})
export class SessionLogComponent {
  readonly sessionId = input.required<string>();
  /** Dernière activité de la session : chaque changement déclenche le chargement de la suite du journal. */
  readonly lastTs = input.required<number>();
  /** Recherche imposée de l'extérieur (« Voir dans le journal », palette) ; un objet par demande ; reste modifiable ensuite. */
  readonly query = input<{ q: string } | null>(null);

  protected readonly vm = inject(SessionLogVm);
  protected readonly agentLabel = (a: string) => a || 'Tous les agents';

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    this.vm.connect(this.sessionId, this.lastTs, this.query);
    // Nouvelle recherche ou nouveau filtre : on revient en haut, là où sont les résultats les plus récents.
    effect(() => {
      this.vm.query(); this.vm.filter(); this.vm.agent();
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = 0;
    });
  }

  protected badge(kind: LogKind): BadgeVariants['variant'] {
    return BADGES[kind];
  }
}
