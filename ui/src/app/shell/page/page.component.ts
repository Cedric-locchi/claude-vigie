import { Component, input } from '@angular/core';

/** `scroll` : le corps défile. `fill` : le corps remplit la hauteur, ses colonnes défilent chacune (DESIGN.md, Layout). */
export type PageMode = 'scroll' | 'fill';

/**
 * Gabarit de toutes les pages routées : en-tête (`[pageHeader]`), barre d'onglets facultative (`[pageTabs]`), corps (le reste).
 * Il porte la règle de défilement, une fois pour toutes :
 * - bureau : la coque fait la hauteur de la fenêtre (app.ts), en-tête et onglets restent fixes, un seul défilement ;
 * - téléphone (≤ 720 px) : seul le document défile, la barre d'onglets colle sous la barre mobile.
 * Réglages par variables : --page-pt / --page-px / --page-pb (padding), --page-gap (entre zones et sections), --page-max (largeur, padding compris).
 */
@Component({
  selector: 'app-page',
  host: { '[attr.data-mode]': 'mode()' },
  template: `
    <div class="page-head"><ng-content select="[pageHeader]" /></div>
    <div class="page-tabs"><ng-content select="[pageTabs]" /></div>
    <div class="page-body"><div class="page-inner"><ng-content /></div></div>
  `,
  styles: `
    :host {
      --page-pt: 28px; --page-px: 36px; --page-pb: 40px; --page-gap: 24px; --page-max: 100vw;
      flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: var(--page-gap); padding-top: var(--page-pt);
      /* Fond pointillé de la zone de contenu (décisions 040, 043) : fixe sous le corps qui défile ; cartes et panneaux ont un fond plein. */
      background: var(--dots);
    }
    .page-head, .page-tabs { flex: none; display: flex; flex-direction: column; gap: var(--page-gap); max-width: var(--page-max); padding-inline: var(--page-px); }
    /* Zone vide (pas d'en-tête, onglets masqués) : ni place ni écart. */
    .page-head:not(:has(> :not([hidden]))), .page-tabs:not(:has(> :not([hidden]))) { display: none; }
    /* Le corps est la seule zone qui défile ; 4px rendus en haut pour que l'anneau de focus du premier élément ne soit pas rogné. */
    .page-body { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-top: -4px; padding: 4px var(--page-px) var(--page-pb); overflow: hidden auto; }
    .page-inner { flex: none; min-width: 0; display: flex; flex-direction: column; gap: var(--page-gap); width: 100%; max-width: calc(var(--page-max) - 2 * var(--page-px)); }
    /* fill : le corps ne défile pas, il donne sa hauteur à la vue ; chaque colonne de la vue défile seule (clip : rien ne peut le faire défiler, même scrollIntoView). */
    :host([data-mode='fill']) .page-body { overflow: clip; }
    :host([data-mode='fill']) .page-inner { flex: 1; min-height: 0; }

    @media (max-width: 720px) {
      :host { --page-pt: 20px; --page-px: 16px; --page-pb: 32px; --sticky-top: 52px; flex: none; }
      /* Ce qui colle en haut du document : barre mobile (52px, app.ts) puis barre d'onglets (41px, page de session). Lu par le lanceur des plugins et les ancres. */
      :host(:has(> .page-tabs > :not([hidden]))) { --sticky-top: 93px; }
      .page-tabs { position: sticky; top: 52px; z-index: 2; background: var(--bg); }
      /* Seul le document défile : le corps et la vue prennent leur hauteur naturelle, quel que soit le mode. */
      .page-body, :host([data-mode='fill']) .page-body { flex: none; overflow: visible; }
      :host([data-mode='fill']) .page-inner { flex: none; }
    }
  `,
})
export class PageComponent {
  readonly mode = input<PageMode>('scroll');
}
