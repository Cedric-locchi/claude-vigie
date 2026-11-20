import { Component, inject, input, output } from '@angular/core';
import { Agent } from '../../../../core/models';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { AgentCardComponent } from '../agent-card/agent-card.component';
import { AgentPanelVm } from './agent-panel.vm';

/** Sidebar de détail d'un agent : état en direct, dernier message complet, fil utile (messages, code écrit, erreurs). */
@Component({
  selector: 'app-agent-panel',
  imports: [AgentCardComponent, HlmSheetImports],
  providers: [AgentPanelVm],
  template: `
    <!-- Toujours monté : l'état ouvert/fermé suit agent() ; le contenu (shown) reste affiché pendant l'animation de fermeture.
         autoFocus sur le titre : le premier élément focusable serait « Autoriser », un Entrée de trop autoriserait la commande. -->
    <hlm-sheet side="right" autoFocus="first-heading" [state]="agent() ? 'open' : 'closed'" (stateChanged)="$event === 'closed' && closed.emit()">
      <hlm-sheet-content *hlmSheetPortal class="sheet" closeLabel="Fermer le détail de l'agent">
        @if (vm.shown(); as a) {
          <hlm-sheet-header class="head">
            <h2 hlmSheetTitle>{{ a.name }}</h2>
            <p hlmSheetDescription>{{ a.sub ? 'Sous-agent' : 'Agent principal' }}</p>
          </hlm-sheet-header>
          <div class="body">
            <app-agent-card [agent]="a" [canAnswer]="canAnswer()" [error]="error()" (allow)="allow.emit()" (refuse)="refuse.emit()" (focusTerminal)="focusTerminal.emit()" />

            @if (a.description) {
              <section><h3>Mission</h3><p class="small">{{ a.description }}</p></section>
            }

            @if (vm.brief(); as b) {
              <section>
                <h3>Brief</h3>
                <div class="markdown" [innerHTML]="b.html"></div>
                @if (b.truncated) { <p class="small faint">Texte coupé à 4000 caractères.</p> }
              </section>
            }

            @if (a.lastText) {
              <section>
                <div class="report-head">
                  <h3>{{ a.state === 'done' ? 'Rapport' : 'Dernier message' }}</h3>
                  <button type="button" class="copy" aria-live="polite" (click)="vm.copy()">{{ vm.copied() ? 'Copié' : 'Copier le markdown' }}</button>
                </div>
                <!-- Markdown rendu ; [innerHTML] passe par le sanitizer d'Angular (scripts et handlers retirés). -->
                <div class="markdown" [innerHTML]="vm.html()"></div>
                @if (a.lastTextTruncated) {
                  <p class="small faint truncated">Message coupé à 20 000 caractères</p>
                }
              </section>
            }

            <section>
              <h3>Fil de l'agent</h3>
              @for (e of vm.feed(); track e.id) {
                <div class="entry" [attr.data-kind]="e.kind">
                  <div class="meta"><time class="mono small faint">{{ e.time }}</time><span class="small">{{ e.title }}</span></div>
                  @if (e.html) {
                    <div class="markdown" [innerHTML]="e.html"></div>
                  } @else if (e.code) {
                    <pre class="code">{{ e.code }}</pre>
                  }
                  @if (e.truncated) { <p class="small faint">Texte coupé à 4000 caractères.</p> }
                </div>
              } @empty {
                <p class="small faint">{{ vm.logError() ?? "Rien d'utile à montrer pour l'instant." }}</p>
              }
            </section>
          </div>
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
  styles: `
    .sheet { width: min(720px, 100vw); max-width: none; padding: 0; gap: 0; }
    .head { padding: 16px 48px 14px 18px; border-bottom: 1px solid var(--line); }
    .body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 18px; }
    section { display: flex; flex-direction: column; gap: 8px; }
    h3 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
    p { line-height: 1.5; overflow-wrap: anywhere; }
    .report-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .copy { border: 0; padding: 2px 6px; background: transparent; color: var(--faint); font: inherit; font-size: 11px; cursor: pointer; transition: background-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .copy:hover { background: var(--hover); color: var(--text); }
    .copy:active { background: var(--press); }
    .entry { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .entry:last-child { border-bottom: 0; }
    .meta { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--text-2); }
    .meta span { overflow-wrap: anywhere; }
    .entry[data-kind='error'] .meta, .entry[data-kind='error'] .code { color: var(--err); }
    .code { margin: 0; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 6px; background: var(--hover); font-family: var(--mono); font-size: 12px; line-height: 1.5; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  `,
})
export class AgentPanelComponent {
  protected readonly vm = inject(AgentPanelVm);
  /** null : sidebar fermée. */
  readonly agent = input<Agent | null>(null);
  readonly sessionId = input<string | null>(null);
  readonly canAnswer = input(false);
  readonly error = input<string | null>(null);
  readonly closed = output();
  readonly allow = output();
  readonly refuse = output();
  readonly focusTerminal = output();

  constructor() {
    this.vm.connect(this.agent, this.sessionId);
  }
}
