import { Injectable, computed, effect, inject, linkedSignal, resource, signal } from '@angular/core';
import { PluginHost } from '@vigie/plugin-sdk';
import { XcodeProject as XcodeProjectSchema, XcodeTargets as XcodeTargetsSchema } from '../contract.mjs';
import type { Simulator, XcodeAction, XcodeContainer, XcodeTargets } from './models';

export const CONTAINER_KINDS: Record<XcodeContainer['kind'], string> = { workspace: 'Workspace', project: 'Projet', package: 'Paquet SPM' };

/** Action principale d'abord ; Clean n'a pas besoin de simulateur. */
export const XCODE_ACTIONS: { action: XcodeAction; label: string }[] = [
  { action: 'run', label: 'Lancer sur le simulateur' },
  { action: 'build', label: 'Build' },
  { action: 'test', label: 'Test' },
  { action: 'clean', label: 'Clean' },
];
const needsSimulator = (action: XcodeAction) => action !== 'clean';

/**
 * Scheme et simulateur choisis, par projet (dossier de la session).
 * ponytail: mémoire du module, perdue au rechargement ; localStorage si on veut la garder.
 */
const picks = new Map<string, { scheme?: string; udid?: string }>();
/** Dernières cibles lues par session : réaffichées dès l'entrée dans l'onglet, pendant la relecture (jusqu'à 45 s). */
const lastTargets = new Map<string, XcodeTargets>();

/** Garde le choix courant s'il existe encore, sinon le choix mémorisé du projet, sinon le défaut. */
const keep = (list: string[], ...candidates: (string | null | undefined)[]) => candidates.find((c) => c != null && list.includes(c)) ?? null;

const message = (e: unknown, fallback: string) => (e as Error | undefined)?.message || fallback;

/**
 * Onglet « Xcode » : le projet (conteneur + scripts, rapide) et les schemes / simulateurs (lent) viennent du backend du plugin ;
 * on lance une action ou un script dans un nouveau terminal, que la page affiche.
 */
@Injectable()
export class XcodeVm {
  private readonly host = inject(PluginHost);

  private readonly id = computed(() => this.host.sessionId());
  private readonly key = computed(() => this.host.cwd());
  private readonly params = () => ({ id: this.id(), cwd: this.key() });

  private readonly projectResource = resource({ params: this.params, loader: ({ abortSignal }) => this.host.call('project', {}, XcodeProjectSchema, { signal: abortSignal }) });
  private readonly project = computed(() => (this.projectResource.hasValue() ? this.projectResource.value() : null));
  readonly container = computed(() => this.project()?.container ?? null);
  readonly kindLabel = computed(() => { const c = this.container(); return c ? CONTAINER_KINDS[c.kind] : ''; });
  readonly scripts = computed(() => this.project()?.scripts ?? []);

  /** Lue à la création du VM (entrée dans l'onglet) et sur « Rafraîchir », jamais ailleurs : xcodebuild -list coûte. */
  private readonly targetsResource = resource({ params: this.params, loader: ({ abortSignal }) => this.host.call('targets', {}, XcodeTargetsSchema, { signal: abortSignal }) });
  readonly targets = computed<XcodeTargets | null>(() => (this.targetsResource.hasValue() ? this.targetsResource.value() : lastTargets.get(this.id()) ?? null));
  private readonly remember = effect(() => {
    if (this.targetsResource.hasValue()) lastTargets.set(this.id(), this.targetsResource.value());
  });
  readonly loading = computed(() => this.targetsResource.isLoading());
  /** Échec de lecture (daemon d'une autre version, erreur réseau) ; les dernières cibles restent affichées. */
  readonly targetsError = computed(() => {
    for (const r of [this.projectResource, this.targetsResource]) if (r.status() === 'error') return message(r.error(), 'Lecture du projet Xcode impossible.');
    return null;
  });
  readonly available = computed(() => !!this.targets()?.available);

  readonly schemes = computed(() => this.targets()?.schemes ?? []);
  readonly simulators = computed(() => this.targets()?.simulators ?? []);
  /** Simulateurs groupés par runtime, dans l'ordre du daemon. */
  readonly runtimes = computed(() => {
    const groups = new Map<string, Simulator[]>();
    for (const s of this.simulators()) groups.set(s.runtime, [...(groups.get(s.runtime) ?? []), s]);
    return [...groups].map(([runtime, sims]) => ({ runtime, sims }));
  });

  readonly scheme = linkedSignal<{ key: string; list: string[] }, string | null>({
    source: () => ({ key: this.key(), list: this.schemes() }),
    computation: (s, prev) => keep(s.list, prev?.source.key === s.key ? prev.value : null, picks.get(s.key)?.scheme, s.list[0]),
  });
  /** Défaut : le premier simulateur démarré, sinon le premier iPhone (le daemon trie les iPad avant), sinon le premier. */
  readonly udid = linkedSignal<{ key: string; sims: Simulator[] }, string | null>({
    source: () => ({ key: this.key(), sims: this.simulators() }),
    computation: (s, prev) => keep(s.sims.map((x) => x.udid), prev?.source.key === s.key ? prev.value : null, picks.get(s.key)?.udid, s.sims.find((x) => x.booted)?.udid, s.sims.find((x) => x.name.startsWith('iPhone'))?.udid, s.sims[0]?.udid),
  });
  readonly simulatorLabel = (udid: string | null) => this.simulators().find((s) => s.udid === udid)?.name ?? '';

  /** Une requête à la fois : les boutons restent inactifs le temps de la requête. */
  readonly launching = signal(false);
  readonly launchError = signal<string | null>(null);

  pickScheme(scheme: string): void {
    this.scheme.set(scheme);
    picks.set(this.key(), { ...picks.get(this.key()), scheme });
  }

  pickSimulator(udid: string): void {
    this.udid.set(udid);
    picks.set(this.key(), { ...picks.get(this.key()), udid });
  }

  canRun(action: XcodeAction): boolean {
    return !this.launching() && this.available() && !!this.scheme() && (!needsSimulator(action) || !!this.udid());
  }

  refresh(): void {
    this.projectResource.reload();
    this.targetsResource.reload();
  }

  run(action: XcodeAction): Promise<void> {
    const scheme = this.scheme();
    const udid = this.udid();
    if (!scheme || !this.canRun(action)) return Promise.resolve();
    return this.request(() => this.host.terminal(action, needsSimulator(action) && udid ? { scheme, udid } : { scheme }), 'Impossible de lancer l’action Xcode.');
  }

  runScript(name: string): Promise<void> {
    return this.request(() => this.host.terminal('script', { name }), 'Impossible de lancer le script.');
  }

  /** Ouvre le projet dans Xcode : rien à afficher dans Vigie, seul l'échec se signale. */
  openInXcode(): Promise<void> {
    return this.request(() => this.host.call('open'), 'Impossible d’ouvrir Xcode.');
  }

  private async request(fn: () => Promise<unknown>, fallback: string): Promise<void> {
    if (this.launching()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      await fn();
    } catch (e) {
      this.launchError.set(message(e, fallback));
    } finally {
      this.launching.set(false);
    }
  }
}
