import { Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { StepDetail } from '../timeline.vm';

/** Détail d'une étape de la chronologie : paramètres et résultat (ou erreur), repris du journal. */
@Component({
  selector: 'app-step-detail',
  imports: [HlmButton],
  host: { role: 'region', '[attr.aria-label]': "'Détail de ' + name()" },
  template: `
    @if (loading()) {
      <p class="small faint">Chargement du détail…</p>
    } @else if (detail(); as d) {
      <div class="cols">
        <div>
          <h4>Paramètres</h4>
          <pre>{{ d.input ?? '—' }}</pre>
        </div>
        <div>
          <h4 [class.text-err]="d.error">{{ d.error ? 'Erreur' : 'Résultat' }}</h4>
          <pre [class.text-err]="d.error">{{ d.output ?? (running() ? 'En cours…' : '—') }}</pre>
        </div>
      </div>
      <div class="foot">
        @if (d.truncated) { <span class="small faint">Texte coupé à 4000 caractères.</span> }
        <button hlmBtn variant="outline" size="sm" (click)="openLog.emit()">Voir dans le journal</button>
      </div>
    } @else {
      <p class="small faint">Détail indisponible.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; min-width: 0; margin: 2px 14px 8px calc(34px + var(--depth, 0) * 18px); padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; }
    .cols > div { min-width: 0; }
    h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); }
    pre { margin: 0; max-height: 260px; overflow: auto; padding: 8px 10px; border-radius: 6px; background: var(--surface); font-family: var(--mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
    .foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
  `,
})
export class StepDetailComponent {
  readonly name = input.required<string>();
  readonly running = input(false);
  readonly loading = input(false);
  readonly detail = input<StepDetail | null>(null);
  readonly openLog = output();
}
