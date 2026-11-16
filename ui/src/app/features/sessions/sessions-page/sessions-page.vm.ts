import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionSummary } from '../../../core/models';
import { ConfirmService } from '../../../core/confirm.service';
import { CLIENT_OS } from '../../../core/platform';
import { KEYS, VigieService, sendReply } from '../../../core/vigie.service';
import { activityMax, describeSession, rank } from '../../../core/session-view';
import { keepLast } from '../../../core/signals';
import { WEEKS, activityGrid } from '../activity-grid/activity-grid';

const SPARK_H = 22;

@Injectable()
export class SessionsPageVm {
  private readonly vigie = inject(VigieService);
  /** ⌘N affiché seulement sur mac (voir AppVm.mac). */
  readonly mac = inject(CLIENT_OS) === 'mac';
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  readonly search = signal('');
  readonly snapshot = this.vigie.snapshot;
  readonly loading = computed(() => !this.snapshot());
  /** Délai de premier contact écoulé : « Connexion au daemon… » cède la place à la marche à suivre. */
  private readonly waitedTooLong = signal(false);
  /**
   * Premier lancement bloqué : aucun snapshot après 5 s et pas de connexion ouverte (daemon arrêté ou absent).
   * Un snapshot qui arrive ensuite remplace aussitôt le message (dérivé, rien à défaire).
   */
  readonly unreachable = computed(() => this.waitedTooLong() && this.loading() && !this.vigie.connected());

  constructor() {
    const timer = setTimeout(() => this.waitedTooLong.set(true), 5000);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
  readonly now = computed(() => this.snapshot()?.now ?? 0);
  readonly usage = computed(() => this.snapshot()?.usage ?? null);

  /** Activité des 12 derniers mois (grille façon GitHub) ; null tant que l'historique n'est pas arrivé. */
  private readonly history = keepLast(this.vigie.usageResource(signal(WEEKS * 7)));
  readonly activity = computed(() => {
    const h = this.history();
    return h ? activityGrid(h.rows, h.now) : null;
  });

  private readonly sessions = computed(() => {
    const q = this.search().trim().toLowerCase();
    const all = this.snapshot()?.sessions ?? [];
    return q ? all.filter((s) => `${s.title} ${s.project} ${s.branch ?? ''}`.toLowerCase().includes(q)) : all;
  });

  readonly waiting = computed(() => this.sessions().filter((s) => s.state === 'waiting' || s.state === 'turn'));
  readonly running = computed(() => this.sessions().filter((s) => s.state === 'running'));
  readonly done = computed(() => {
    const startOfDay = new Date(this.now()).setHours(0, 0, 0, 0);
    return this.sessions().filter((s) => s.state === 'done' && s.lastTs >= startOfDay);
  });
  readonly activeCount = computed(() => this.waiting().length + this.running().length);

  /** Bandeau d'indicateurs en direct. */
  readonly kpis = computed(() => {
    const active = [...this.waiting(), ...this.running()];
    const w = this.usage()?.window;
    return {
      blocked: this.waiting().filter((s) => s.state === 'waiting').length,
      turn: this.waiting().filter((s) => s.state === 'turn').length,
      running: this.running().length,
      doneToday: this.done().length,
      subagents: active.reduce((n, s) => n + s.activeSubagents, 0),
      todayCost: this.usage()?.today.cost ?? 0,
      window: w?.active ? { pct: w.pct, end: w.end, limitAt: w.limitAt, bar: Math.min(100, w.pct * 100) } : null,
    };
  });

  /** Une ligne par session, la plus urgente en haut puis par ordre de démarrage (stable : une session qui bouge garde sa place) ; l'activité est à la même échelle pour toutes. */
  readonly rows = computed(() => {
    const list = [...this.waiting(), ...this.running(), ...this.done()].sort((a, b) => rank(a) - rank(b) || b.firstTs - a.firstTs);
    const max = activityMax(list);
    return list.map((s) => describeSession(s, this.now(), max, SPARK_H));
  });

  /** Ids cochés ; seuls ceux encore visibles comptent (une session disparue ou filtrée sort de la sélection). */
  private readonly picked = signal<ReadonlySet<string>>(new Set());
  readonly selected = computed(() => this.rows().filter((r) => this.picked().has(r.s.id)).map((r) => r.s));
  readonly selectedIds = computed(() => new Set(this.selected().map((s) => s.id)));
  readonly allSelected = computed(() => this.rows().length > 0 && this.selected().length === this.rows().length);
  readonly someSelected = computed(() => this.selected().length > 0 && !this.allSelected());

  toggle(id: string, on: boolean): void {
    const next = new Set(this.selectedIds());
    if (on) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  /** Porte sur les lignes visibles (filtrées par la recherche). */
  toggleAll(on: boolean): void {
    this.picked.set(on ? new Set(this.rows().map((r) => r.s.id)) : new Set());
  }

  clearSelection(): void {
    this.picked.set(new Set());
  }

  /** Une seule confirmation, puis une suppression par session : un échec n'arrête pas les autres et reste coché. */
  async removeSelected(): Promise<void> {
    const list = this.selected();
    if (!list.length || !(await this.confirm.deleteSessions(list.length, list.some((s) => !!s.terminalId)))) return;
    const results = await Promise.allSettled(list.map((s) => this.vigie.deleteSession(s.id)));
    this.picked.set(new Set(list.filter((_, i) => results[i].status === 'rejected').map((s) => s.id)));
  }

  setSearch(term: string): void {
    this.search.set(term);
  }

  /** Échec de la dernière réponse rapide, affiché sur la ligne de la session concernée. */
  readonly replyError = signal<{ id: string; message: string } | null>(null);

  allow(s: SessionSummary): Promise<void> {
    return this.reply(s, KEYS.allow);
  }

  refuse(s: SessionSummary): Promise<void> {
    return this.reply(s, KEYS.refuse);
  }

  private async reply(s: SessionSummary, keys: string): Promise<void> {
    if (!s.terminalId) return;
    this.replyError.set(null);
    const message = await sendReply(this.vigie, s.terminalId, keys);
    if (message) this.replyError.set({ id: s.id, message });
  }

  /** Clic n'importe où sur une ligne : ouvre la session, sauf sur ses boutons/liens ou après une sélection de texte. */
  openRow(event: MouseEvent, id: string): void {
    if ((event.target as Element | null)?.closest('a, button, input')) return;
    if (event.view?.getSelection()?.toString()) return;
    this.router.navigate(['/sessions', id]);
  }

  /** Session lancée ailleurs : on la reprend dans Vigie puis on ouvre son terminal. */
  async resume(s: SessionSummary): Promise<void> {
    if (!(await this.confirm.resumeSession(s))) return;
    await this.vigie.resumeSession(s);
    await this.router.navigate(['/sessions', s.id]);
  }

  async remove(s: SessionSummary): Promise<void> {
    if (await this.confirm.deleteSession(s)) await this.vigie.deleteSession(s.id);
  }
}
