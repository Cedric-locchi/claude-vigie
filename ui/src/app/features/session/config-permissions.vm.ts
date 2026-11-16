import { Injectable, computed, inject, signal } from '@angular/core';
import { KIND_LABEL, Kind, annotate, filterRules, groupRules } from './config-rules';
import { SessionConfigVm } from './session-config.vm';

/** Au-delà, un groupe démarre replié (sauf recherche en cours ou conflit). */
const OPEN_MAX = 8;

/** Rubrique Permissions : résumé par décision, recherche, règles groupées par outil ou serveur MCP. */
@Injectable()
export class ConfigPermissionsVm {
  private readonly parent = inject(SessionConfigVm);

  readonly query = signal('');
  /** Décision filtrée (null : toutes). */
  readonly kind = signal<Kind | null>(null);
  /** Groupes ouverts ou fermés à la main, l'emporte sur l'ouverture par défaut. */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());

  /** Conflits calculés sur toutes les portées : une règle remplacée par l'organisation le reste même filtrée sur Projet. */
  private readonly all = computed(() => annotate(this.parent.config()?.permissions ?? []));
  private readonly visible = computed(() => filterRules(this.all(), { scope: this.parent.scope(), kind: null, query: this.query() }));

  readonly total = computed(() => this.all().length);

  /** Un compteur par décision (hors mode), cliquable comme filtre. */
  readonly summary = computed(() =>
    (['allow', 'ask', 'deny'] as const).map((kind) => ({ kind, label: KIND_LABEL[kind], count: this.visible().filter((r) => r.kind === kind).length })),
  );

  /** Mode par défaut effectif : celui de la portée la plus prioritaire. */
  readonly mode = computed(() => this.all().find((r) => r.kind === 'mode' && (r.status === null || r.status === 'wins'))?.rule ?? null);

  readonly groups = computed(() => {
    const searching = !!this.query().trim();
    const toggled = this.toggled();
    return groupRules(this.visible().filter((r) => !this.kind() || r.kind === this.kind())).map((g) => ({
      ...g,
      open: toggled.get(g.key) ?? (searching || g.conflicts > 0 || g.rules.length <= OPEN_MAX),
    }));
  });

  setKind(kind: Kind): void {
    this.kind.update((k) => (k === kind ? null : kind));
  }

  /** Ignore l'écho du `toggle` natif quand l'état affiché change déjà (ouverture par défaut, recherche). */
  toggle(key: string, open: boolean): void {
    if (this.groups().find((g) => g.key === key)?.open === open) return;
    this.toggled.update((m) => new Map(m).set(key, open));
  }
}
