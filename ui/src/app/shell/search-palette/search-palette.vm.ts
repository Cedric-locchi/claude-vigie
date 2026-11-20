import { Injectable, computed, debounced, inject, linkedSignal, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { clock, excerpt } from '../../core/format';
import { SessionSearch, SessionState } from '../../core/models';
import { LOG_KIND_LABELS, stateLabel } from '../../core/session-view';
import { keepLast } from '../../core/signals';
import { SEARCH_DELAY, SEARCH_MIN, VigieService, daemonError } from '../../core/vigie.service';

/** Extraits montrés au plus par session (le daemon en envoie 5, les plus récents). */
export const SHOWN_HITS = 3;

/** Réponse du daemon avec le terme qui l'a produite : surlignage et ouverture du Journal suivent la réponse affichée, pas la saisie. */
type Found = SessionSearch & { q: string };

/** Ligne du journal trouvée : type, heure, extrait découpé autour du terme (titre de la ligne s'il n'est que dans le titre). */
export interface PaletteHit { id: string; kind: string; time: string; parts: { pre: string; hit: string; post: string } }

/** Option de la palette : une session trouvée, jointe au snapshot (titre, projet, état). */
export interface PaletteRow { id: string; title: string; project: string; state: SessionState; stateLabel: string; found: string; hits: PaletteHit[] }

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Palette de recherche dans les sessions (⌘F / Ctrl+F hors vue Fichiers, décision 049) : le terme est cherché par le daemon
 * dans le titre et le journal de toutes les sessions du snapshot ; une option par session, la plus récemment active d'abord.
 */
@Injectable()
export class SearchPaletteVm {
  private readonly vigie = inject(VigieService);
  private readonly router = inject(Router);

  readonly query = signal('');
  private readonly q = computed(() => this.query().trim());
  private readonly short = computed(() => this.q().length < SEARCH_MIN);

  /** Terme envoyé SEARCH_DELAY ms après la dernière frappe ; undefined (moins de SEARCH_MIN caractères) : tout de suite, sans requête. */
  private readonly term = debounced(
    () => (this.short() ? undefined : this.q()),
    (v) => (v === undefined ? undefined : new Promise<void>((r) => setTimeout(r, SEARCH_DELAY))),
  );
  // Nouveau terme : resource() annule le chargement en cours (abortSignal coupe la requête HTTP) et ignore sa réponse.
  private readonly res = resource({
    params: () => (this.term.hasValue() ? this.term.value() : undefined),
    loader: ({ params: q, abortSignal }) => this.vigie.searchSessions(q, abortSignal).then((r): Found => ({ ...r, q })),
  });
  /** Dernière réponse, gardée pendant la recherche suivante (pas de clignotement à chaque frappe). */
  private readonly kept = keepLast(this.res);
  readonly pending = computed(() => !this.short() && (this.term.isLoading() || this.res.isLoading()));
  readonly error = computed(() => (!this.short() && this.res.status() === 'error' ? daemonError(this.res.error(), 'Recherche impossible.') : null));
  /** Réponse affichée : aucune sous SEARCH_MIN caractères ni en erreur. */
  private readonly found = computed(() => (this.short() || this.error() ? null : this.kept()));
  readonly truncated = computed(() => !!this.found()?.truncated);

  /** Sessions trouvées, dans l'ordre du daemon ; une session absente du snapshot (supprimée entre-temps) est ignorée. */
  readonly rows = computed<PaletteRow[]>(() => {
    const f = this.found();
    if (!f) return [];
    const byId = new Map((this.vigie.snapshot()?.sessions ?? []).map((s) => [s.id, s]));
    return f.sessions.flatMap((r) => {
      const s = byId.get(r.id);
      if (!s) return [];
      const hits = r.hits.slice(0, SHOWN_HITS).map((h): PaletteHit => ({
        id: h.id, kind: LOG_KIND_LABELS[h.kind], time: clock(h.ts),
        parts: h.at === null ? { pre: h.title, hit: '', post: '' } : excerpt(h.text, h.at, f.q.length),
      }));
      return [{ id: s.id, title: s.title, project: s.project, state: s.state, stateLabel: stateLabel(s.state, s.reason), found: r.count ? plural(r.count, 'ligne') : 'Titre', hits }];
    });
  });

  /** Résumé sous le champ ; `err` : message du daemon (400, daemon muet ou hors contrat). */
  readonly summary = computed<{ text: string; err?: boolean } | null>(() => {
    if (!this.q()) return null;
    if (this.short()) return { text: `Tape au moins ${SEARCH_MIN} caractères.` };
    if (this.pending()) return { text: 'Recherche…' };
    const e = this.error();
    if (e) return { text: e, err: true };
    if (!this.found()) return null;
    const n = this.rows().length;
    return { text: n ? plural(n, 'session') : 'Aucun résultat' };
  });

  /** Option sélectionnée (clavier, survol) : la première à chaque réponse. */
  readonly index = linkedSignal({ source: this.found, computation: () => 0 });

  /** Touche dans le champ : ↑↓ circulaires ('move'), Entrée ouvre la session sélectionnée ('pick') ; Échap est au composant. */
  key(key: string): 'move' | 'pick' | null {
    const n = this.rows().length;
    const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
    if (step && n) {
      this.index.set((this.index() + step + n) % n);
      return 'move';
    }
    return key === 'Enter' && this.pick(this.index()) ? 'pick' : null;
  }

  /**
   * Ouvre la session, Historique > Journal filtré sur le terme de la réponse affichée (`?log=`, lu par la page de session).
   * ponytail: la palette ouvre le Journal filtré sur le terme, pas sur la ligne trouvée ; un `?line=` si on veut y sauter.
   */
  pick(i: number): boolean {
    const r = this.rows()[i], f = this.found();
    if (!r || !f) return false;
    void this.router.navigate(['/sessions', r.id], { queryParams: { log: f.q } });
    return true;
  }
}
