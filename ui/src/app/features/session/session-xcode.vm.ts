import { Injectable, Signal, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { Simulator, TerminalBody, XcodeAction, XcodeContainer, XcodeProject, XcodeTargets } from '../../core/models';
import { VigieService } from '../../core/vigie.service';

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
 * ponytail: mémoire du module (pas de helper localStorage dans le dépôt), perdue au rechargement ; localStorage si on veut la garder.
 */
const picks = new Map<string, { scheme?: string; udid?: string }>();
/** Dernières cibles lues par session : réaffichées dès l'entrée dans l'onglet, pendant la relecture (jusqu'à 30 s). */
const lastTargets = new Map<string, XcodeTargets>();

/** Garde le choix courant s'il existe encore, sinon le choix mémorisé du projet, sinon le défaut. */
const keep = (list: string[], ...candidates: (string | null | undefined)[]) => candidates.find((c) => c != null && list.includes(c)) ?? null;

/**
 * Onglet « Xcode » : le projet (conteneur + scripts) vient de la page, qui décide si l'onglet existe ;
 * ici on lit les schemes et simulateurs (lent) et on lance une action ou un script dans un nouveau terminal, que la page affiche.
 */
@Injectable()
export class SessionXcodeVm {
  private readonly vigie = inject(VigieService);
  private readonly source = signal<{ id: Signal<string>; cwd: Signal<string>; project: Signal<XcodeProject | null>; opened: (terminalId: string) => void } | null>(null);

  private readonly id = computed(() => this.source()?.id() ?? null);
  private readonly key = computed(() => this.source()?.cwd() ?? '');
  readonly container = computed(() => this.source()?.project()?.container ?? null);
  readonly kindLabel = computed(() => { const c = this.container(); return c ? CONTAINER_KINDS[c.kind] : ''; });
  readonly scripts = computed(() => this.source()?.project()?.scripts ?? []);

  /** Lue à la création du VM (entrée dans l'onglet) et sur « Rafraîchir », jamais ailleurs : xcodebuild -list coûte. */
  private readonly targetsResource = this.vigie.xcodeTargetsResource(this.id);
  readonly targets = computed<XcodeTargets | null>(() => {
    if (this.targetsResource.hasValue()) return this.targetsResource.value();
    const id = this.id();
    return id ? lastTargets.get(id) ?? null : null;
  });
  private readonly remember = effect(() => {
    const id = this.id();
    if (id && this.targetsResource.hasValue()) lastTargets.set(id, this.targetsResource.value());
  });
  readonly loading = computed(() => this.targetsResource.isLoading());
  /** Échec de lecture (daemon d'une autre version, erreur réseau) ; les dernières cibles restent affichées. */
  readonly targetsError = computed(() => (this.targetsResource.status() === 'error' ? this.targetsResource.error()?.message || 'Lecture du projet Xcode impossible.' : null));
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

  connect(id: Signal<string>, cwd: Signal<string>, project: Signal<XcodeProject | null>, opened: (terminalId: string) => void): void {
    this.source.set({ id, cwd, project, opened });
  }

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
    this.targetsResource.reload();
  }

  run(action: XcodeAction): Promise<void> {
    const scheme = this.scheme();
    const udid = this.udid();
    if (!scheme || !this.canRun(action)) return Promise.resolve();
    return this.launch({ xcode: needsSimulator(action) && udid ? { action, scheme, udid } : { action, scheme } }, 'Impossible de lancer l’action Xcode.');
  }

  runScript(name: string): Promise<void> {
    return this.launch({ script: name }, 'Impossible de lancer le script.');
  }

  /** Ouvre le projet dans Xcode : rien à afficher dans Vigie, seul l'échec se signale. */
  openInXcode(): Promise<void> {
    return this.request((id) => this.vigie.openXcode(id), 'Impossible d’ouvrir Xcode.');
  }

  private launch(body: TerminalBody, fallback: string): Promise<void> {
    return this.request(async (id) => this.source()?.opened((await this.vigie.openShell(id, body)).id), fallback);
  }

  private async request(fn: (sessionId: string) => Promise<unknown>, fallback: string): Promise<void> {
    const id = this.id();
    if (!id || this.launching()) return;
    this.launching.set(true);
    this.launchError.set(null);
    try {
      await fn(id);
    } catch (e) {
      this.launchError.set((e as { error?: { error?: string } })?.error?.error ?? fallback);
    } finally {
      this.launching.set(false);
    }
  }
}
