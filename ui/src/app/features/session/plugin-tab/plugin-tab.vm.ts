import { DOCUMENT, Injectable, InjectionToken, Injector, Signal, computed, inject, resource, signal } from '@angular/core';
import { PluginHost } from '../../../../plugin-sdk/host';
import { PLUGIN_UIS } from '../../../core/plugin-uis.generated';
import { VigieService } from '../../../core/vigie.service';
import { createPluginHost } from './plugin-host';

/** Table des fronts de plugins (générée au build) ; jeton pour que les specs la remplacent. */
export const PLUGIN_UI_TABLE = new InjectionToken<typeof PLUGIN_UIS>('PLUGIN_UI_TABLE', { providedIn: 'root', factory: () => PLUGIN_UIS });

interface Source { id: Signal<string>; cwd: Signal<string>; pid: Signal<string>; opened: (terminalId: string) => void; refresh: () => void }

/**
 * Onglet d'un plugin (décision 037) : charge à la demande le composant du plugin et lui fournit un `PluginHost`.
 * Plugin absent de la table (pas de front dans cette version) ou chargement en échec : un message à la place.
 */
@Injectable()
export class PluginTabVm {
  private readonly vigie = inject(VigieService);
  private readonly table = inject(PLUGIN_UI_TABLE);
  private readonly parent = inject(Injector);
  private readonly source = signal<Source | null>(null);

  connect(src: Source): void {
    this.source.set(src);
  }

  /** Composant du plugin ; `null` = pas de front pour ce plugin. */
  readonly ui = resource({
    params: () => this.source()?.pid(),
    loader: async ({ params: pid }) => (Object.hasOwn(this.table, pid) ? (await this.table[pid]()).default : null),
  });

  readonly missing = computed(() => this.ui.status() === 'resolved' && !this.ui.value());

  /** Injecteur du composant du plugin : `PluginHost` par-dessus celui de l'onglet. */
  readonly injector = computed(() => {
    const src = this.source();
    if (!src) return undefined;
    const host = createPluginHost({ vigie: this.vigie, sessionId: src.id, cwd: src.cwd, pid: src.pid, opened: src.opened, reloadTabs: src.refresh });
    return Injector.create({ providers: [{ provide: PluginHost, useValue: host }], parent: this.parent });
  });

  readonly inputs = computed(() => ({ sessionId: this.source()?.id() ?? '' }));

  private readonly document = inject(DOCUMENT);

  /** Refait l'import() du front du plugin. */
  // ponytail: un navigateur peut garder en cache l'échec d'un import() dynamique (même URL de chunk) : Réessayer ne sert
  // alors à rien et seul « Recharger la page » s'en sort. Un import() avec un paramètre anti-cache si ça gêne vraiment.
  retry(): void {
    this.ui.reload();
  }

  /** Seconde voie si Réessayer ne suffit pas : recharge toute l'app. */
  reloadPage(): void {
    this.document.location.reload();
  }
}
