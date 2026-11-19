import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import * as f from '../../../core/format';
import { PlotChartComponent } from '../plot-chart/plot-chart.component';
import { UsageHeroComponent } from '../usage-hero/usage-hero.component';
import { colorOf } from '../usage-series';
import { UsagePageVm } from './usage-page.vm';
import { PageComponent } from '../../../shell/page/page.component';

@Component({
  selector: 'app-usage-page',
  imports: [PageComponent, RouterLink, PlotChartComponent, UsageHeroComponent, HlmCardImports, HlmProgressImports, HlmTableImports, HlmToggleGroupImports],
  providers: [UsagePageVm],
  template: `
    <app-page>
      <header pageHeader>
        <h1>Consommation</h1>
        <p class="muted">Calculée depuis les transcripts locaux · coûts estimés au tarif API, même sur abonnement</p>
      </header>

      @if (vm.failed()) {
        <div hlmCard class="pad error"><p class="small">Le daemon ne fournit pas le détail de consommation (<span class="mono">/api/usage</span>). S'il tourne depuis avant la mise à jour, redémarre-le avec <span class="mono">systemctl --user restart vigie</span> (Linux) ou <span class="mono">launchctl kickstart -k gui/$UID/dev.vigie.daemon</span> (macOS), ou relance l'app.</p></div>
      }

      <div class="toolbar">
        <div hlmToggleGroup type="single" variant="outline" size="sm" [nullable]="false" aria-label="Période" [value]="vm.period()" (valueChange)="vm.setPeriod($any($event))">
          @for (p of vm.periods; track p.value) { <button hlmToggleGroupItem [value]="p.value">{{ p.label }}</button> }
        </div>
        <div hlmToggleGroup type="single" variant="outline" size="sm" [nullable]="false" aria-label="Mesure" [value]="vm.metric()" (valueChange)="vm.setMetric($any($event))">
          <button hlmToggleGroupItem value="cost">Coût $</button>
          <button hlmToggleGroupItem value="tokens">Tokens</button>
        </div>
        <div hlmToggleGroup type="single" variant="outline" size="sm" aria-label="Filtrer par modèle" [value]="vm.family()" (valueChange)="vm.setFamily($any($event))">
          @for (fam of vm.families(); track fam) {
            <button hlmToggleGroupItem [value]="fam"><i class="sw" [style.background]="color(fam)"></i>{{ fam }}</button>
          }
        </div>
      </div>

      <app-usage-hero />

      @let t = vm.totals();
      <section class="kpis" aria-label="Totaux de la période">
        <div hlmCard class="pad kpi"><span class="small muted">Coût estimé</span><span class="mono big">{{ f.usd(t.cost) }}</span><span class="small faint">{{ f.usd(t.perDay) }} / jour</span></div>
        <div hlmCard class="pad kpi"><span class="small muted">Tokens</span><span class="mono big">{{ f.tokens(t.tokens) }}</span><span class="small faint">sortie {{ f.tokens(t.output) }}</span></div>
        <div hlmCard class="pad kpi"><span class="small muted">Depuis le cache</span><span class="mono big" [class.watch]="t.tokens && t.cacheRate < 0.5">{{ f.pct(t.cacheRate) }}</span><span class="small faint">de l'entrée</span></div>
      </section>

      @if (vm.window(); as w) {
        <section hlmCard class="pad" aria-label="Fenêtre en cours">
          <div class="row">
            <span class="strong">Fenêtre de 5 h en cours</span>
            @if (w.active) {
              <span class="small muted">{{ f.clock(w.start!) }} → {{ f.clock(w.end!) }}
                @if (w.limitAt) { · <span class="wait">au rythme actuel, limite atteinte vers {{ f.clock(w.limitAt) }}</span> }
              </span>
            } @else {
              <span class="small muted">aucune activité depuis 5 h</span>
            }
          </div>
          <div class="meter tall">
            <span [style.width.%]="vm.windowBar().used"></span>
            <i [style.left.%]="vm.windowBar().used" [style.width.%]="vm.windowBar().projected"></i>
          </div>
          <div class="row small faint mono">
            <span>{{ f.pct(w.pct) }} utilisé@if (!w.real) { · {{ f.tokens(w.tokens) }} tok }@if (w.weekPct != null) { · semaine {{ f.pct(w.weekPct) }} }</span>
            <span>projection {{ f.pct(w.projectedPct) }} en fin de fenêtre</span>
          </div>
          @if (w.real && w.readAt) {
            <p class="small faint">Chiffre réel de Claude Code, relevé il y a {{ f.duration(vm.now() - w.readAt) }} par ta statusline.</p>
          }
          @if (!w.real) {
            <p class="small faint">Estimation : aucune session n'a encore remonté la limite réelle dans cette fenêtre, 100 % = ta plus grosse fenêtre des 14 derniers jours.</p>
          }
        </section>
      }

      <section hlmCard class="pad" aria-labelledby="chart-sessions">
        <div class="row">
          <h2 id="chart-sessions">Sessions : {{ vm.metric() === 'cost' ? 'coût' : 'tokens' }} et part lue depuis le cache</h2>
          <span class="small muted">Clic sur un point : ouvre la session</span>
        </div>
        @if (vm.topSessions().length) {
          <app-plot-chart class="pick" [draw]="vm.sessionsDraw()" [label]="vm.sessionsLabel()" />
          <div class="legend small muted" aria-hidden="true">
            <span><i class="sw c-data"></i>cache ≥ 50 %</span>
            <span><svg width="12" height="12" viewBox="0 0 12 12" class="tri"><path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>sous 50 % : recharge beaucoup de contexte</span>
          </div>
        } @else {
          <p class="empty small faint">{{ vm.loaded() ? 'Aucune session sur cette période.' : 'Chargement…' }}</p>
        }
      </section>

      <section hlmCard class="pad" aria-label="Par modèle">
        <span class="strong">Par modèle</span>
        <div hlmTableContainer><table hlmTable>
          <thead hlmTHead><tr hlmTr><th hlmTh>Modèle</th><th hlmTh>Coût</th><th hlmTh>Part</th><th hlmTh>Entrée</th><th hlmTh>Sortie</th><th hlmTh>Cache écrit</th><th hlmTh>Cache lu</th></tr></thead>
          <tbody hlmTBody>
            @for (m of vm.models(); track m.model) {
              <tr hlmTr>
                <td hlmTd><i class="sw" [style.background]="color(m.family)"></i><span class="mono">{{ m.model }}</span></td>
                <td hlmTd class="mono">{{ f.usd(m.cost) }}</td>
                <td hlmTd class="mono">{{ f.pct(m.share) }}</td>
                <td hlmTd class="mono">{{ f.tokens(m.input) }}</td>
                <td hlmTd class="mono">{{ f.tokens(m.output) }}</td>
                <td hlmTd class="mono">{{ f.tokens(m.cacheCreate) }}</td>
                <td hlmTd class="mono">{{ f.tokens(m.cacheRead) }}</td>
              </tr>
            } @empty {
              <tr hlmTr><td hlmTd class="faint" colspan="7">{{ vm.loaded() ? 'Rien sur cette période.' : 'Chargement…' }}</td></tr>
            }
          </tbody>
        </table></div>
      </section>

      <div class="split">
        <section hlmCard class="pad" aria-label="Par projet">
          <span class="strong">Par projet</span>
          @for (p of vm.projects(); track p.project) {
            <div class="proj">
              <div class="row"><span>{{ p.project }}</span><span class="mono">{{ p.label }}</span></div>
              <hlm-progress [value]="p.width" aria-hidden="true"><hlm-progress-indicator /></hlm-progress>
            </div>
          } @empty { <p class="small faint">Rien sur cette période.</p> }
        </section>

        <section hlmCard class="pad" aria-label="Sessions les plus coûteuses">
          <span class="strong">Sessions les plus coûteuses</span>
          <div hlmTableContainer><table hlmTable>
            <thead hlmTHead><tr hlmTr><th hlmTh>Session</th><th hlmTh>Coût</th><th hlmTh>Tokens</th><th hlmTh>Cache</th></tr></thead>
            <tbody hlmTBody>
              @for (s of vm.topSessions(); track s.id) {
                <tr hlmTr>
                  <td hlmTd class="whitespace-normal"><a [routerLink]="['/sessions', s.id]">{{ s.title }}</a> <span class="faint small">· {{ s.project }} · {{ s.models.join(', ') }}</span></td>
                  <td hlmTd class="mono">{{ f.usd(s.cost) }}</td>
                  <td hlmTd class="mono">{{ f.tokens(s.tokens) }}</td>
                  <td hlmTd class="mono" [class.watch]="s.lowCache">{{ f.pct(s.cacheRate) }}@if (s.lowCache) { · à surveiller }</td>
                </tr>
              }
            </tbody>
          </table></div>
        </section>
      </div>
      <p class="small faint">Coûts estimés : tarif API par million de tokens (cache écrit 1,25 × entrée, lu 0,1 × entrée). Sur abonnement, c'est l'équivalent de ce que tu aurais payé à l'API.</p>
    </app-page>
  `,
  styles: `
    header { display: flex; flex-direction: column; gap: 4px; }
    h1 { font-size: 24px; font-weight: 600; }
    .row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
    .strong { font-weight: 600; }
    .meter.tall { height: 12px; background: var(--muted); }
    .meter i { position: absolute; top: 0; height: 100%; background: var(--projected); }

    .error { border-color: var(--err-line); color: var(--err); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; }

    .sw { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; vertical-align: -1px; background: var(--neutral); }
    .c-data { background: var(--data); }
    h2 { margin: 0; font-size: 14px; font-weight: 600; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .tri { margin-right: 6px; vertical-align: -1px; color: var(--text); }
    .empty { padding: 24px 0; }
    /* Les points et barres sont cliquables (Plot ne pose pas de curseur). */
    .pick { cursor: pointer; }
    /* À surveiller : appuyé par la graisse et l'encre, pas par l'ambre (réservé à ce qui attend). */
    .watch { color: var(--text); font-weight: 600; }

    .kpis { display: flex; flex-wrap: wrap; gap: 16px; }
    .pad { padding: 16px 18px; gap: 10px; }
    .kpis .kpi { flex: 1 1 200px; display: flex; flex-direction: column; gap: 4px; }
    .big { font-size: 24px; font-weight: 500; }

    .split { display: flex; flex-wrap: wrap; gap: 16px; }
    .split > [hlmCard] { flex: 1 1 380px; min-width: 0; }
    .proj { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    th + th, td + td { text-align: right; }
  `,
})
export class UsagePageComponent {
  protected readonly vm = inject(UsagePageVm);
  protected readonly f = f;
  protected readonly color = colorOf;
}
