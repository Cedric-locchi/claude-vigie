import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { marked } from 'marked';
import * as f from '../../../../core/format';
import { Agent } from '../../../../core/models';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { AgentCardComponent } from '../agent-card/agent-card.component';

const RECENT_TOOLS = 30;

/** Sidebar de détail d'un agent : état en direct, dernier message complet, outils récents. */
@Component({
  selector: 'app-agent-panel',
  imports: [AgentCardComponent, HlmSheetImports, HlmTooltip],
  template: `
    <!-- Toujours monté : l'état ouvert/fermé suit agent() ; le contenu (shown) reste affiché pendant l'animation de fermeture.
         autoFocus sur le titre : le premier élément focusable serait « Autoriser », un Entrée de trop autoriserait la commande. -->
    <hlm-sheet side="right" autoFocus="first-heading" [state]="agent() ? 'open' : 'closed'" (stateChanged)="$event === 'closed' && closed.emit()">
      <hlm-sheet-content *hlmSheetPortal class="panel" closeLabel="Fermer le détail de l'agent">
        @if (shown(); as a) {
          <hlm-sheet-header class="head">
            <h2 hlmSheetTitle>{{ a.name }}</h2>
            <p hlmSheetDescription>{{ a.sub ? 'Sous-agent' : 'Agent principal' }}</p>
          </hlm-sheet-header>
          <div class="body">
            <app-agent-card [agent]="a" [canAnswer]="canAnswer()" [error]="error()" (allow)="allow.emit()" (refuse)="refuse.emit()" (focusTerminal)="focusTerminal.emit()" />

            @if (a.description) {
              <section><h3>Mission</h3><p class="small">{{ a.description }}</p></section>
            }

            @if (a.lastText) {
              <section>
                <div class="report-head">
                  <h3>{{ a.state === 'done' ? 'Rapport' : 'Dernier message' }}</h3>
                  <button type="button" class="copy" (click)="copy(a.lastText)" [attr.aria-label]="'Copier le markdown du ' + (a.state === 'done' ? 'rapport' : 'message')">{{ copied() ? 'Copié' : 'Copier le markdown' }}</button>
                </div>
                <!-- Markdown rendu ; [innerHTML] passe par le sanitizer d'Angular (scripts et handlers retirés). -->
                <div class="markdown" [innerHTML]="html()"></div>
                @if (a.lastTextTruncated) {
                  <p class="small faint truncated">Message coupé à 20 000 caractères</p>
                }
              </section>
            }

            <section>
              <h3>Outils récents</h3>
              @for (t of tools(); track $index) {
                <div class="tool" [class.err]="t.error">
                  <span class="k" [class]="'k k-' + t.kind"></span>
                  <span class="mono small label" [hlmTooltip]="t.name + ' · ' + t.label" [showDelay]="400">{{ t.name }} · {{ t.label }}</span>
                  <span class="mono small faint">{{ t.end ? f.duration(t.end - t.start) : 'en cours' }}</span>
                </div>
              } @empty {
                <p class="small faint">Aucun outil appelé pour l'instant.</p>
              }
            </section>
          </div>
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
  styles: `
    .panel { width: min(720px, 100vw); max-width: none; padding: 0; gap: 0; }
    .head { padding: 16px 48px 14px 18px; border-bottom: 1px solid var(--line); }
    .body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 18px; }
    section { display: flex; flex-direction: column; gap: 8px; }
    h3 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
    p { line-height: 1.5; overflow-wrap: anywhere; }
    .report-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .copy { border: 0; padding: 2px 6px; background: transparent; color: var(--faint); font: inherit; font-size: 11px; cursor: pointer; transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .copy:hover { background: var(--hover); color: var(--text); }
    .copy:active { background: var(--press); }
    .tool { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0 -6px; padding: 3px 6px; border-radius: 6px; transition: background-color var(--dur-fast) var(--ease); }
    .tool:hover { background: var(--hover); }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
    .tool.err .label { color: var(--err); }
    .k { flex: none; width: 8px; height: 8px; border-radius: 2px; }
    .k-read { background: var(--read); }
    .k-edit { background: var(--brand); }
    .k-command { background: var(--text-2); }
    .k-agent { background: var(--data); }
    .k-other { background: var(--neutral); }
  `,
})
export class AgentPanelComponent {
  /** null : sidebar fermée. */
  readonly agent = input<Agent | null>(null);
  readonly canAnswer = input(false);
  readonly error = input<string | null>(null);
  readonly closed = output();
  readonly allow = output();
  readonly refuse = output();
  readonly focusTerminal = output();

  protected readonly f = f;
  /** Dernier agent affiché, gardé pendant l'animation de fermeture. */
  protected readonly shown = linkedSignal<Agent | null, Agent | null>({
    source: this.agent,
    computation: (agent, previous) => agent ?? previous?.value ?? null,
  });
  /** Les plus récents d'abord. */
  /** Dernier message (le rapport, une fois l'agent terminé), en markdown GFM : titres, listes, tableaux, code. */
  protected readonly html = computed(() => marked.parse(this.shown()?.lastText ?? '', { async: false, gfm: true, breaks: true }));
  protected readonly copied = signal(false);

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  protected readonly tools = computed(() => (this.shown()?.bars ?? []).slice(-RECENT_TOOLS).reverse());
}
