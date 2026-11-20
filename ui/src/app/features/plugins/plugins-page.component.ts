import { Component, inject } from '@angular/core';
import { PluginsPageVm } from './plugins-page.vm';
import { PageComponent } from '../../shell/page/page.component';

/** Plugins de Vigie : une carte par plugin, un clic l'active ou le désactive. Rien ne se télécharge, tout est livré avec l'app. */
@Component({
  selector: 'app-plugins-page',
  imports: [PageComponent],
  providers: [PluginsPageVm],
  template: `
    <app-page>
      <header pageHeader>
        <h1>Plugins de Vigie</h1>
        <p class="muted">Chaque plugin ajoute un onglet aux sessions dont le projet s'y prête. Désactivé, son code ne tourne pas.</p>
        <p class="small faint">À ne pas confondre avec les plugins Claude Code, listés dans l'onglet Config d'une session.</p>
      </header>

      @if (vm.loadError(); as err) {
        <p class="err" role="alert">{{ err }}</p>
      } @else if (vm.plugins(); as list) {
        <ul class="cards" aria-label="Plugins de Vigie">
          @for (p of list; track p.id) {
            @let failed = vm.failure()?.id === p.id ? vm.failure()?.message : null;
            <li>
              <button type="button" class="card panel" [attr.aria-pressed]="p.enabled" [disabled]="vm.busy() === p.id" (click)="vm.toggle(p)"
                [attr.aria-describedby]="'plugin-desc-' + p.id">
                <span class="top">
                  <span class="name">{{ p.name }}</span>
                  <span class="state small">
                    @if (vm.busy() === p.id) { {{ p.enabled ? 'Désactivation…' : 'Activation…' }} }
                    @else { <span class="dot" aria-hidden="true"></span>{{ p.enabled ? 'Actif' : 'Désactivé' }} }
                  </span>
                </span>
                <span class="desc small" [id]="'plugin-desc-' + p.id">{{ p.description }}</span>
                @if (p.error) { <span class="err small">{{ p.error }}</span> }
                <span class="hint small">{{ p.enabled ? 'Clique pour le désactiver' : 'Clique pour l’activer' }}</span>
              </button>
              @if (failed) { <p class="err small" role="alert">{{ failed }}</p> }
            </li>
          } @empty {
            <li class="muted">Aucun plugin livré avec cette version de Vigie.</li>
          }
        </ul>
      } @else {
        <p class="muted" role="status">Chargement…</p>
      }
    </app-page>
  `,
  styles: `
    app-page { --page-max: 760px; --page-gap: 12px; }
    header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    h1 { font-size: 24px; font-weight: 600; }
    p { margin: 0; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
    li { display: flex; flex-direction: column; gap: 6px; }
    .card {
      flex: 1; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 14px 18px; text-align: left;
      color: var(--text); font: inherit; cursor: pointer;
      transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur) var(--ease);
    }
    .card:hover:not(:disabled) { background: var(--hover); border-color: var(--line-strong); box-shadow: var(--elev-2); }
    .card:active:not(:disabled) { background: var(--press); }
    .card:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .card:disabled { cursor: progress; }
    .card[aria-pressed='true'] { border-color: var(--brand); background: var(--brand-bg); }
    .top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .name { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
    .state { flex: none; display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); }
    .dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor; }
    [aria-pressed='true'] .state { color: var(--brand); }
    [aria-pressed='true'] .dot { background: currentColor; }
    .desc { color: var(--text-muted); }
    .hint { color: var(--faint); }
    .err { color: var(--err); overflow-wrap: anywhere; }
    @media (prefers-reduced-motion: reduce) { .card { transition: none; } }
  `,
})
export class PluginsPageComponent {
  protected readonly vm = inject(PluginsPageVm);
}
