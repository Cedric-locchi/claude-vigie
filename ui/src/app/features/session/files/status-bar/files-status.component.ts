import { Component, inject } from '@angular/core';
import { SessionFilesVm } from '../session-files.vm';

/**
 * Barre d'état de l'onglet Fichiers : neutre au repos ; quand Claude travaille, elle passe au bleu « en cours »
 * et dit pourquoi l'éditeur est en lecture seule. Vue seule : l'état vient de `SessionFilesVm`.
 */
@Component({
  selector: 'app-files-status',
  host: { '[class.busy]': '!vm.idle()' },
  template: `
    @if (vm.branch(); as b) {
      <span class="mono"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9" /></svg><span class="sr-only">Branche </span>{{ b }}</span>
    }
    @if (!vm.idle()) { <span class="claude"><span class="pulse" aria-hidden="true"></span>Claude travaille, éditeur en lecture seule</span> }
    @if (vm.status(); as s) {
      <span class="mono push">Ln {{ vm.position().line }}, Col {{ vm.position().col }}</span>
      <span class="mono">{{ s.lines }} ligne{{ s.lines > 1 ? 's' : '' }}</span>
      <span class="mono">{{ s.eol }}</span>
      <span>{{ s.lang ?? 'Texte brut' }}</span>
      @if (vm.dirty()) { <span class="on">Non enregistré</span> }
    }
  `,
  styles: `
    :host {
      grid-column: 1 / -1; display: flex; align-items: center; gap: 0 16px; min-height: 24px; padding: 0 12px; overflow: hidden; white-space: nowrap;
      border-top: 1px solid var(--line); background: var(--bg); color: var(--faint); font-size: 11px;
      transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
    }
    :host > * { display: inline-flex; align-items: center; gap: 4px; }
    :host(.busy) { background: var(--brand-bg); color: var(--text-2); box-shadow: inset 0 1px 0 var(--brand); }
    .ic { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .push { margin-left: auto; }
    .on { color: var(--text); }
    .claude { color: var(--brand); font-weight: 600; }
    .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); animation: pulse 1.6s var(--ease) infinite; }
    @keyframes pulse { 50% { opacity: 0.3; } }
    @media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
    /* Étroit : on garde la position du curseur et « Non enregistré ». */
    @media (max-width: 820px) { .push ~ :not(.on) { display: none; } }
  `,
})
export class FilesStatusComponent {
  protected readonly vm = inject(SessionFilesVm);
}
