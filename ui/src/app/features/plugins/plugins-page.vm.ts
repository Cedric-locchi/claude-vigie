import { Injectable, computed, inject, signal } from '@angular/core';
import { PluginInfo } from '../../core/models';
import { VigieService, daemonError } from '../../core/vigie.service';

/**
 * Page Plugins (décision 034) : les plugins livrés avec Vigie, un clic active ou désactive.
 * Le daemon pousse ensuite un snapshot, les onglets des sessions se relisent d'eux-mêmes.
 */
@Injectable()
export class PluginsPageVm {
  private readonly vigie = inject(VigieService);
  readonly resource = this.vigie.pluginsResource();
  /** Liste illisible (daemon injoignable, d'une autre version) : message à la place des cartes. */
  readonly loadError = computed(() => (this.resource.status() === 'error' ? daemonError(this.resource.error(), 'Liste des plugins illisible.') : null));
  /** Plugins livrés ; null pendant le premier chargement. */
  readonly plugins = computed(() => (this.resource.hasValue() ? this.resource.value() : null));
  /** Plugin en cours de bascule : sa carte reste inactive le temps de la requête. */
  readonly busy = signal<string | null>(null);
  /** Échec de la dernière bascule, affiché sur la carte concernée. */
  readonly failure = signal<{ id: string; message: string } | null>(null);

  async toggle(p: PluginInfo): Promise<void> {
    if (this.busy()) return;
    this.busy.set(p.id);
    this.failure.set(null);
    try {
      const info = await this.vigie.togglePlugin(p.id, !p.enabled);
      if (this.resource.hasValue()) this.resource.value.update((list) => list?.map((x) => (x.id === info.id ? info : x)));
    } catch (e) {
      this.failure.set({ id: p.id, message: daemonError(e, p.enabled ? 'Désactivation impossible.' : 'Activation impossible.') });
      this.resource.reload(); // l'erreur de chargement du plugin s'affiche sur sa carte
    } finally {
      this.busy.set(null);
    }
  }
}
