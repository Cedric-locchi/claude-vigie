import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import * as f from '../../../core/format';
import { SessionsPageVm } from '../sessions-page/sessions-page.vm';

/**
 * Cartes d'indicateurs du Dashboard : libellé + icône, pastille du rôle (en haut à droite), gros chiffre en mono, barre segmentée,
 * ligne de détail avec flèche de tendance. Pastilles et flèches sont décoratives : le texte porte l'information.
 * Vue seulement : les chiffres et les barres viennent de SessionsPageVm (fourni par la page).
 * Les cartes de consommation mènent à la page Consommation.
 */
@Component({
  selector: 'app-dashboard-kpis',
  imports: [RouterLink],
  template: `
    @let k = vm.kpis();
    <section class="kpis" aria-labelledby="kpis-title">
      <h2 id="kpis-title" class="sr-only">Indicateurs</h2>

      <a class="card" data-tone="data" routerLink="/usage">
        <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="12" width="4" height="8" rx="1" /><rect x="10" y="7" width="4" height="13" rx="1" /><rect x="16" y="3" width="4" height="17" rx="1" /></svg></span>
        <span class="label"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>Fenêtre 5 h</span>
        @if (k.window; as w) {
          <span class="big mono">{{ f.pct(w.pct) }}</span>
          <span class="bar" aria-hidden="true">@for (s of w.bar; track $index) { <i [class]="s"></i> }</span>
          <span class="detail">
            @if (w.limitAt) { <span class="up-bad"><svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg></span><span class="strong">limite vers <span class="mono">{{ f.clock(w.limitAt) }}</span></span> au rythme actuel }
            @else if (w.end) { <svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg>remise à zéro à <span class="mono">{{ f.clock(w.end) }}</span> }
          </span>
        } @else {
          <span class="big mono faint">—</span>
          <span class="bar" aria-hidden="true">@for (s of off; track $index) { <i class="off"></i> }</span>
          <span class="detail">aucune fenêtre ouverte</span>
        }
      </a>

      <a class="card" data-tone="brand" routerLink="/usage">
        <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M3 7a3 3 0 0 1 3-3h10a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3zm12.5 7a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0z" /></svg></span>
        <span class="label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M16.5 7.5c-.8-1.2-2.4-2-4.5-2-2.5 0-4 1.3-4 3s1.5 2.5 4 3 4 1.4 4 3.2-1.6 3-4 3c-2.1 0-3.7-.8-4.5-2" /></svg>Coût du jour</span>
        <span class="big"><span class="mono">{{ f.usd(k.todayCost) }}</span>@if (k.threshold) { <span class="of mono"> / {{ f.usd(k.threshold) }}</span> }</span>
        <span class="bar" aria-hidden="true">@for (s of k.costBar ?? off; track $index) { <i [class]="s"></i> }</span>
        <span class="detail">
          @if (k.costBar && k.todayCost > k.threshold!) { <span class="up-bad"><svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg></span><span class="strong">au-dessus de ton seuil</span> · }
          @else if (k.costTrend === 'up') { <svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg> }
          @else if (k.costTrend === 'down') { <span class="down-good"><svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg></span> }
          moyenne 7 j : @if (k.avg) { <span class="mono">{{ f.usd(k.avg.cost) }}</span> } @else { … }
        </span>
      </a>

      <div class="card sessions" [attr.data-tone]="k.blocked || k.turn ? 'wait' : 'data'">
        <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2 20v-1a7 7 0 0 1 14 0v1z" /><circle cx="17" cy="9" r="2.5" /><path d="M17 13.5a5 5 0 0 1 5 5V20h-4.5v-1a8.5 8.5 0 0 0-2.2-5.2 5 5 0 0 1 1.7-.3z" /></svg></span>
        <span class="label"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>Sessions</span>
        <span class="big"><span class="mono">{{ k.running }}</span> <span class="unit">en cours</span></span>
        <span class="bar" aria-hidden="true">
          @for (s of k.sessionBar; track $index) { <i [class]="s"></i> } @empty { @for (s of off; track $index) { <i class="off"></i> } }
        </span>
        <span class="detail" aria-live="polite">
          @if (k.blocked) { <span class="wait"><span class="mono">{{ k.blocked }}</span> t’attend{{ k.blocked > 1 ? 'ent' : '' }}</span> · }
          @if (k.turn) { <span class="wait"><span class="mono">{{ k.turn }}</span> à toi</span> · }
          <span class="mono">{{ k.doneToday }}</span> terminée{{ k.doneToday > 1 ? 's' : '' }} aujourd’hui
        </span>
      </div>

      <a class="card" data-tone="data" routerLink="/usage">
        <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 8.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12c0 1.7-3.6 3-8 3s-8-1.3-8-3zm0 6c0 1.7 3.6 3 8 3s8-1.3 8-3V18c0 1.7-3.6 3-8 3s-8-1.3-8-3z" /></svg></span>
        <span class="label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>Tokens du jour</span>
        <span class="big mono">{{ f.tokens(k.todayTokens) }}</span>
        <span class="bar" aria-hidden="true">@for (s of k.cacheBar; track $index) { <i [class]="s"></i> }</span>
        <span class="detail">
          @if (k.tokensTrend === 'up') { <svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg> } @else if (k.tokensTrend === 'down') { <svg class="trend" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 9v8H9" /></svg> }
          <span class="mono">{{ f.pct(k.cacheRate) }}</span> depuis le cache · moyenne 7 j : @if (k.avg) { <span class="mono">{{ f.tokens(k.avg.tokens) }}</span> } @else { … }
        </span>
      </a>
    </section>
  `,
  styles: `
    /* 4 → 2 → 1 colonnes. */
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
    @media (max-width: 1200px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .kpis { grid-template-columns: minmax(0, 1fr); } }

    /* Couleur du rôle de la carte (décision 042) : pastille et tirets remplis. Fenêtre, Tokens : secondaire ; Coût : principale. */
    .card { --tone: var(--data); --tone-bg: var(--data-bg); }
    .card[data-tone='brand'] { --tone: var(--brand); --tone-bg: var(--brand-bg); }
    /* Sessions : orange seulement s'il y a une attente (Lights-Out). */
    .card[data-tone='wait'] { --tone: var(--wait); --tone-bg: var(--wait-bg); }
    .card {
      position: relative; display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 14px 18px;
      border: 1px solid var(--edge); border-radius: 12px; box-shadow: var(--elev-1); background: var(--surface); color: var(--text-muted);
      transition: box-shadow var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
    }
    a.card:hover { box-shadow: var(--elev-2); border-color: var(--line-strong); }
    a.card:active { background: var(--hover); }
    a.card:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

    /* Pastille : fond lavé + icône pleine du rôle (≥ 3:1 sur son fond, deux thèmes). */
    .badge { position: absolute; top: 14px; right: 18px; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--tone-bg); color: var(--tone); }
    .badge svg { width: 22px; height: 22px; fill: currentColor; }
    .label, .big { padding-right: 52px; }
    .label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-2); }
    .label svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; color: var(--faint); }
    a.card:hover .label svg { color: var(--brand); }

    .big { font-size: 24px; font-weight: 500; line-height: 1.2; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .big .mono, .big.mono { font-family: var(--mono); }
    .of { font-size: 14px; color: var(--faint); }
    .unit { margin-left: 6px; font-size: 13px; color: var(--text-muted); }

    /* Barre segmentée : 20 tirets (un par session pour la carte Sessions). La couleur porte la valeur, jamais la largeur. */
    .bar { display: flex; gap: 3px; height: 6px; }
    .bar i { flex: 1; min-width: 2px; max-width: 24px; border-radius: 2px; background: var(--line-strong); transition: background-color var(--dur) var(--ease); }
    .bar .on { background: var(--tone); }
    .bar .hot { background: var(--err); }
    .bar .wait { background: var(--wait); }
    .bar .turn { background: transparent; box-shadow: inset 0 0 0 1.5px var(--wait); }
    .bar .ok { background: var(--ok); }
    /* Sessions : « en cours » garde sa couleur d'état, quelle que soit la pastille. */
    .sessions .bar .on { background: var(--run); }
    /* Barres à 20 tirets : pleine largeur. */
    .bar:has(> :nth-child(20)) i { max-width: none; }

    .detail { font-size: 12px; min-height: 17px; }
    .detail .mono { color: var(--text); font-weight: 600; }
    /* Flèche de tendance : neutre, verte quand la baisse est une bonne nouvelle, rouge quand la hausse en est une mauvaise. */
    .trend { display: inline-block; width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--faint); }
    .up-bad .trend { color: var(--err); }
    .down-good .trend { color: var(--ok); }
    .strong { color: var(--text); font-weight: 600; }
    .wait, .wait .mono { color: var(--wait); font-weight: 600; }
    .faint { color: var(--faint); }
  `,
})
export class DashboardKpisComponent {
  protected readonly vm = inject(SessionsPageVm);
  protected readonly f = f;
  /** Barre vide (pas de fenêtre ouverte, pas de seuil, aucune session). */
  protected readonly off = Array.from({ length: 20 });
}
