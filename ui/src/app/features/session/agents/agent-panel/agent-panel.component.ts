import { Component, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { marked } from 'marked';
import { Agent, LogEntry } from '../../../../core/models';
import { VigieService } from '../../../../core/vigie.service';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { AgentCardComponent } from '../agent-card/agent-card.component';

const FEED_MAX = 100;
/** Outils dont l'entrée est du code écrit par l'agent ; les lectures et commandes sont du bruit ici. */
const CODE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** Le code d'un appel d'écriture ; le JSON brut s'il est coupé (4000 caractères côté daemon) et ne se relit plus. */
export function codeOf(e: LogEntry): string {
  try {
    const i = JSON.parse(e.text) as { new_string?: string; content?: string; new_source?: string; edits?: { new_string: string }[] };
    return i.edits?.map((x) => x.new_string).join('\n…\n') ?? i.new_string ?? i.content ?? i.new_source ?? e.text;
  } catch {
    return e.text;
  }
}

/** Sidebar de détail d'un agent : état en direct, dernier message complet, fil utile (messages, code écrit, erreurs). */
@Component({
  selector: 'app-agent-panel',
  imports: [AgentCardComponent, HlmSheetImports],
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

            @if (brief(); as b) {
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
              <h3>Fil de l'agent</h3>
              @for (e of feed(); track e.id) {
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
                <p class="small faint">{{ logError() ?? "Rien d'utile à montrer pour l'instant." }}</p>
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
    .entry { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .entry:last-child { border-bottom: 0; }
    .meta { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--text-2); }
    .meta span { overflow-wrap: anywhere; }
    .entry[data-kind='error'] .meta, .entry[data-kind='error'] .code { color: var(--err); }
    .code { margin: 0; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 6px; background: var(--hover); font-family: var(--mono); font-size: 12px; line-height: 1.5; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  `,
})
export class AgentPanelComponent {
  /** null : sidebar fermée. */
  readonly agent = input<Agent | null>(null);
  readonly sessionId = input<string | null>(null);
  readonly canAnswer = input(false);
  readonly error = input<string | null>(null);
  readonly closed = output();
  readonly allow = output();
  readonly refuse = output();
  readonly focusTerminal = output();

  private readonly vigie = inject(VigieService);
  /** Dernier agent affiché, gardé pendant l'animation de fermeture. */
  protected readonly shown = linkedSignal<Agent | null, Agent | null>({
    source: this.agent,
    computation: (agent, previous) => agent ?? previous?.value ?? null,
  });
  /** Dernier message (le rapport, une fois l'agent terminé), en markdown GFM : titres, listes, tableaux, code. */
  protected readonly html = computed(() => marked.parse(this.shown()?.lastText ?? '', { async: false, gfm: true, breaks: true }));
  protected readonly copied = signal(false);

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  /** Journal de la session (tous agents), complété à chaque activité de l'agent ouvert. */
  private readonly log = signal<LogEntry[]>([]);
  protected readonly logError = signal<string | null>(null);
  private loadedFor: string | null = null;
  /** Clé texte : un snapshot qui ne change rien à l'agent ne relance pas de requête. */
  private readonly activity = computed(() => { const a = this.agent(); return a ? `${a.id}:${a.lastTs}` : null; });

  constructor() {
    // Nouvelle activité de l'agent ouvert (lastTs) : on ne demande que la suite du journal.
    effect(() => {
      const id = this.sessionId();
      if (!id || !this.activity()) return;
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    if (this.loadedFor !== id) { this.loadedFor = id; this.log.set([]); }
    try {
      const { entries } = await this.vigie.sessionLog(id, this.log().at(-1)?.ts ?? 0);
      if (this.loadedFor !== id) return;
      this.logError.set(null);
      const known = new Set(this.log().map((e) => e.id));
      const added = entries.filter((e) => !known.has(e.id));
      if (added.length) this.log.update((l) => [...l, ...added]);
    } catch {
      this.logError.set('Fil indisponible : le daemon est-il à jour ?');
    }
  }

  /** Entrées de l'agent ouvert : une entrée du journal a pour id `<agent.id>:<n>`. */
  private readonly own = computed(() => {
    const prefix = `${this.shown()?.id}:`;
    return this.log().filter((e) => e.id.startsWith(prefix));
  });

  /** Brief : la première consigne reçue par un sous-agent (le prompt de l'agent principal). */
  private readonly briefEntry = computed(() => (this.shown()?.sub ? this.own().find((e) => e.kind === 'prompt') : undefined));
  protected readonly brief = computed(() => {
    const e = this.briefEntry();
    return e ? { html: marked.parse(e.text, { async: false, gfm: true, breaks: true }), truncated: e.truncated } : null;
  });

  /** Ce que l'agent dit, les consignes suivantes, le code qu'il écrit et ses erreurs ; le plus récent en haut. */
  protected readonly feed = computed(() => {
    const brief = this.briefEntry();
    return this.own()
      .filter((e) => e !== brief && (e.kind === 'assistant' || e.kind === 'prompt' || e.kind === 'error' || (e.kind === 'tool' && CODE_TOOLS.has(e.title.split(' · ')[0]))))
      .slice(-FEED_MAX)
      .reverse()
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.kind === 'assistant' ? 'Message' : e.title,
        truncated: e.truncated,
        time: new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        html: e.kind === 'assistant' || e.kind === 'prompt' ? marked.parse(e.text, { async: false, gfm: true, breaks: true }) : null,
        code: e.kind === 'tool' ? codeOf(e) : e.text,
      }));
  });
}
