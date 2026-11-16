import { keepLast } from '../../../core/signals';
import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { Router } from '@angular/router';
import * as f from '../../../core/format';
import { UsageRow } from '../../../core/models';
import { VigieService } from '../../../core/vigie.service';
import { heroChart, heroMargins, sessionsChart } from '../usage-charts';
import {
  Metric, Range, addDays, byFamily, dailyByFamily, dayTotals, daysBetween, daysOf, familyOf, groupBy, heroScale, inRange, sessionPoints, startOfDay, stripBlocks, sum,
} from '../usage-series';

export type { Metric } from '../usage-series';
export type Period = '1' | '14' | '30' | '90' | 'month';
export const PERIODS: { value: Period; label: string }[] = [
  { value: '1', label: "Aujourd'hui" }, { value: '14', label: '14 j' }, { value: '30', label: '30 j' }, { value: '90', label: '90 j' }, { value: 'month', label: 'Ce mois' },
];

const monthName = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'long' });

@Injectable()
export class UsagePageVm {
  private readonly vigie = inject(VigieService);
  private readonly router = inject(Router);

  readonly usage = computed(() => this.vigie.snapshot()?.usage ?? null);
  readonly now = computed(() => this.vigie.snapshot()?.now ?? Date.now());
  readonly today = computed(() => startOfDay(this.now()));
  readonly window = computed(() => this.usage()?.window ?? null);
  /** Part déjà consommée et part projetée jusqu'à la fin de la fenêtre, en % de la barre. */
  readonly windowBar = computed(() => {
    const w = this.window();
    if (!w?.active) return { used: 0, projected: 0 };
    const used = Math.min(100, w.pct * 100);
    return { used, projected: Math.max(0, Math.min(100, w.projectedPct * 100) - used) };
  });

  // --- Réglages de l'analyse ---
  readonly periods = PERIODS;
  readonly period = signal<Period>('14');
  readonly metric = signal<Metric>('cost');
  /** Famille de modèles retenue ; null = toutes. */
  readonly family = signal<string | null>(null);

  /** Jours affichés par le graphique quotidien. */
  readonly span = computed<Range>(() => {
    const today = this.today();
    const p = this.period();
    const from = p === 'month' ? new Date(today).setDate(1) : addDays(today, 1 - Number(p));
    return { from, to: today };
  });
  /** Sous-période choisie au clic dans le graphique ; repart à la période entière quand elle change. */
  readonly selection = linkedSignal<Range, Range>({ source: this.span, computation: (span) => span });
  readonly custom = computed(() => this.selection().from !== this.span().from || this.selection().to !== this.span().to);
  /** Jours demandés au daemon : ceux de la période. */
  readonly days = computed(() => Math.min(400, daysBetween(this.span().from, this.today())));

  private readonly rowsResource = this.vigie.usageResource(this.days);
  /** Garde les dernières lignes pendant un rechargement (chaque minute, ou changement de période) : pas de clignotement. */
  private readonly data = keepLast(this.rowsResource);
  readonly loaded = computed(() => this.data() !== null);
  /** Daemon injoignable ou trop ancien (sans /api/usage) : on le dit au lieu d'afficher « Chargement… » à vie. */
  readonly failed = computed(() => this.rowsResource.status() === 'error');
  /** Daemon antérieur à l'historique des fenêtres (`windows` absent). */
  readonly noWindows = computed(() => this.loaded() && !this.data()?.windows);

  /** Familles présentes, pour la légende et le filtre. */
  readonly families = computed(() => [...new Set((this.data()?.rows ?? []).map((r) => familyOf(r.model)))].sort(byFamily));
  private readonly modelRows = computed(() => {
    const fam = this.family();
    return (this.data()?.rows ?? []).filter((r) => !fam || familyOf(r.model) === fam);
  });
  /** Lignes de la sélection et du modèle retenus : base des tableaux, du nuage et des fenêtres. */
  readonly selected = computed(() => this.modelRows().filter((r) => inRange(startOfDay(r.day), this.selection())));

  private value(rows: UsageRow[]): number {
    return this.metric() === 'cost' ? sum(rows).cost : sum(rows).tokens;
  }
  readonly format = (n: number) => (this.metric() === 'cost' ? f.usd(n) : f.tokens(n));
  readonly metricLabel = computed(() => (this.metric() === 'cost' ? 'Coût' : 'Tokens'));

  readonly rangeLabel = computed(() => {
    const { from, to } = this.selection();
    const d = (ts: number) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    if (!this.custom()) {
      const p = this.period();
      return p === '1' ? "Aujourd'hui" : p === 'month' ? `Depuis le 1er ${monthName(from)}` : `${p} derniers jours`;
    }
    return from === to ? d(from) : `${d(from)} → ${d(to)}`;
  });

  readonly totals = computed(() => {
    const s = sum(this.selected());
    const { from, to } = this.selection();
    return { ...s, perDay: s.cost / daysBetween(from, to) };
  });

  /** Par modèle exact : répartition des tokens et coût. */
  readonly models = computed(() => {
    const total = Math.max(1e-9, sum(this.selected()).cost);
    return [...groupBy(this.selected(), (r) => r.model)]
      .map(([model, rs]) => ({ model, family: familyOf(model), ...sum(rs), share: sum(rs).cost / total }))
      .sort((a, b) => b.cost - a.cost);
  });

  readonly projects = computed(() => {
    const list = [...groupBy(this.selected(), (r) => r.project)].map(([project, rs]) => ({ project, value: this.value(rs) })).sort((a, b) => b.value - a.value);
    const max = Math.max(1e-9, list[0]?.value ?? 0);
    return list.slice(0, 8).map((p) => ({ ...p, width: (p.value / max) * 100, label: this.format(p.value) }));
  });

  private readonly sessions = computed(() => sessionPoints(this.selected()));
  readonly topSessions = computed(() =>
    [...this.sessions()].sort((a, b) => (this.metric() === 'cost' ? b.cost - a.cost : b.tokens - a.tokens)).slice(0, 10),
  );
  readonly lowCacheCount = computed(() => this.sessions().filter((s) => s.lowCache).length);

  // --- Graphique héros : barres par jour, cumul, seuil, bande des fenêtres de 5 h ---
  private readonly settings = this.vigie.settingsResource();
  /** Seuil d'alerte du coût du jour (réglages), en métrique coût seulement ; null = pas de seuil. */
  readonly threshold = computed(() => (this.metric() === 'cost' && this.settings.hasValue() ? this.settings.value()?.alerts?.dailyCost ?? null : null));
  readonly spanDays = computed(() => daysOf(this.span()));
  private readonly spanRows = computed(() => this.modelRows().filter((r) => inRange(startOfDay(r.day), this.span())));
  private readonly spanWindows = computed(() => (this.data()?.windows ?? []).filter((w) => inRange(startOfDay(w.start), this.span())));
  readonly daily = computed(() => dailyByFamily(this.spanRows(), this.metric(), this.selection()));
  readonly dayTotals = computed(() => dayTotals(this.daily(), this.spanDays(), this.threshold(), this.spanWindows()));
  readonly cumulTotal = computed(() => this.dayTotals().at(-1)?.cumul ?? 0);
  readonly overDays = computed(() => this.dayTotals().filter((d) => d.over).length);
  private readonly scale = computed(() => heroScale(Math.max(0, ...this.dayTotals().map((d) => d.total)), this.cumulTotal(), this.threshold()));
  /** Marges du graphique, reprises par la bande des fenêtres pour rester alignée jour pour jour. */
  readonly margins = computed(() => heroMargins(this.scale(), this.metric()));
  readonly heroDraw = computed(() => heroChart(this.daily(), {
    metric: this.metric(), families: this.families(), totals: this.dayTotals(), scale: this.scale(), margins: this.margins(),
    threshold: this.threshold(), pick: (day, extend) => this.pickDay(day, extend),
  }));
  readonly heroLabel = computed(() => {
    const top = [...this.dayTotals()].sort((a, b) => b.total - a.total)[0];
    const thr = this.threshold();
    return `${this.metricLabel()} par jour, ${this.rangeLabel()} : ${this.format(this.cumulTotal())} cumulés sur la période`
      + (top?.total ? `, maximum ${this.format(top.total)} le ${new Date(top.day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : '')
      + (thr != null ? `, ${this.overDays()} jour${this.overDays() > 1 ? 's' : ''} au-dessus du seuil de ${this.format(thr)}` : '')
      + '. Détail jour par jour dans le tableau qui suit.';
  });

  /** Fenêtres de 5 h de la période, en intensité sur la bande. */
  readonly strip = computed(() => stripBlocks(this.spanWindows(), this.spanDays(), this.metric()));
  /** Sélection sur la bande, en % de sa largeur. */
  readonly selectionBox = computed(() => {
    const days = this.spanDays();
    const { from, to } = this.selection();
    const i = Math.max(0, days.indexOf(from));
    const j = Math.max(i, days.indexOf(to));
    return { left: (i / days.length) * 100, width: ((j - i + 1) / days.length) * 100 };
  });

  readonly sessionsDraw = computed(() => sessionsChart(this.sessions(), { metric: this.metric(), open: (id) => this.openSession(id) }));
  readonly sessionsLabel = computed(() =>
    `${this.sessions().length} sessions placées selon leur ${this.metric() === 'cost' ? 'coût' : 'nombre de tokens'} et leur taux de cache ; ${this.lowCacheCount()} sous 50 % de cache. Le détail est dans le tableau des sessions les plus coûteuses.`);

  // --- Interactions ---
  setMetric(m: Metric): void { this.metric.set(m); }
  setPeriod(p: string): void { if (PERIODS.some((x) => x.value === p)) this.period.set(p as Period); }
  setFamily(fam: string | null): void { this.family.set(fam || null); }
  /** Revient à la période entière. */
  resetSelection(): void { this.selection.set(this.span()); }

  /** Clic sur un jour : ce jour seul ; Maj+clic : étend la sélection jusqu'à lui. Re-clic sur le jour seul : toute la période. */
  pickDay(day: number, extend: boolean): void {
    const { from, to } = this.selection();
    if (extend && this.custom()) this.selection.set({ from: Math.min(from, day), to: Math.max(to, day) });
    else if (from === day && to === day) this.resetSelection();
    else this.selection.set({ from: day, to: day });
    const i = this.spanDays().indexOf(day);
    this.cursor.set(i);
    if (!extend) this.anchor.set(i);
  }

  // Sélection sur la bande des fenêtres (index de jour dans la période) : `anchor` reste fixe, `cursor` bouge.
  private readonly anchor = signal(0);
  private readonly cursor = signal(0);
  private readonly dragging = signal(false);
  private selectIndexes(a: number, b: number): void {
    const days = this.spanDays();
    this.anchor.set(a);
    this.cursor.set(b);
    this.selection.set({ from: days[Math.min(a, b)], to: days[Math.max(a, b)] });
  }

  /** Appui sur la bande : commence une sélection à ce jour ; Maj : étend la sélection en cours jusqu'à lui. */
  brushStart(i: number, extend: boolean): void {
    this.dragging.set(true);
    if (!extend || !this.custom()) return this.selectIndexes(i, i);
    const days = this.spanDays();
    const [a, b] = [days.indexOf(this.selection().from), days.indexOf(this.selection().to)];
    this.selectIndexes(i < a ? b : a, i);
  }
  brushMove(i: number): void { if (this.dragging()) this.selectIndexes(this.anchor(), i); }
  brushEnd(): void { this.dragging.set(false); }

  /** Clavier sur la bande : flèches (Maj : étendre), Début / Fin, Échap : toute la période. Renvoie true si la touche est prise. */
  brushKey(key: string, extend: boolean): boolean {
    const last = this.spanDays().length - 1;
    if (key === 'Escape') {
      if (!this.custom()) return false;
      this.resetSelection();
      return true;
    }
    const moves: Record<string, (c: number) => number> = { ArrowLeft: (c) => c - 1, ArrowRight: (c) => c + 1, Home: () => 0, End: () => last };
    if (!moves[key]) return false;
    // Première touche sur la période entière : on se pose sur le jour le plus récent (gauche, Fin) ou le plus ancien.
    const cursor = this.custom() ? Math.max(0, Math.min(last, moves[key](this.cursor()))) : key === 'ArrowRight' || key === 'Home' ? 0 : last;
    this.selectIndexes(extend && this.custom() ? this.anchor() : cursor, cursor);
    return true;
  }

  openSession(id: string): void {
    void this.router.navigate(['/sessions', id]);
  }
}
