import { Component, input } from '@angular/core';
import { TerminalComponent } from '../terminal/terminal.component';

/** Terminal détaché dans sa propre fenêtre : il recouvre la navigation, rien d'autre. */
@Component({
  selector: 'app-terminal-window',
  imports: [TerminalComponent],
  template: `<app-terminal [terminalId]="id()" />`,
  styles: `
    :host { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column; background: var(--bg-deep); }
    app-terminal { flex: 1; }
  `,
})
export class TerminalWindowComponent {
  readonly id = input.required<string>();
}
