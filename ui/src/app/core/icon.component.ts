import { Component, computed, input } from '@angular/core';

/** Tracés des icônes répétées dans l'app (24 × 24, trait). Les icônes uniques restent écrites sur place. */
const ICONS = {
  chevron: 'm9 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0M20 20l-3.5-3.5',
  usage: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
} as const;
export type IconName = keyof typeof ICONS;

/**
 * Icône sur l'élément `<svg>` lui-même (`<svg appIcon="chevron">`) : classes, taille et styles du parent s'y appliquent
 * comme avant. Décorative (aria-hidden) : le libellé est porté par le bouton ou le lien.
 */
@Component({
  selector: 'svg[appIcon]',
  host: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'aria-hidden': 'true' },
  template: `<svg:path [attr.d]="d()" />`,
})
export class Icon {
  readonly appIcon = input.required<IconName>();
  protected readonly d = computed(() => ICONS[this.appIcon()]);
}
