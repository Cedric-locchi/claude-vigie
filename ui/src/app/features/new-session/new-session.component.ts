import { Component, ElementRef, afterRenderEffect, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormField } from '@angular/forms/signals';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { Icon } from '../../core/icon.component';
import { NewSessionVm } from './new-session.vm';
import { PageComponent } from '../../shell/page/page.component';

@Component({
  selector: 'app-new-session',
  imports: [PageComponent, Icon, RouterLink, FormField, HlmBadge, HlmButton, HlmCardImports, HlmInputGroupImports, HlmInput, HlmKbd, HlmLabel, HlmSelectImports, HlmToggleGroupImports],
  providers: [NewSessionVm],
  template: `
    <app-page class="backdrop">
      <form hlmCard aria-labelledby="ns-title" (submit)="$event.preventDefault(); vm.launch()" (keydown)="vm.launchOnShortcut($any($event))">
        <div class="top">
          <h1 id="ns-title">Nouvelle session</h1>
          <a hlmBtn variant="ghost" size="icon-sm" routerLink="/" aria-label="Fermer"><svg appIcon="close" width="16" height="16"></svg></a>
        </div>

        <div class="field">
          <label hlmLabel for="ns-name">Nom <span class="faint">(optionnel)</span></label>
          <input hlmInput id="ns-name" [formField]="vm.form.name" placeholder="ex. refonte du login" autocomplete="off" />
        </div>

        <div class="field">
          <label hlmLabel for="ns-dir">Dossier</label>
          <hlm-input-group>
          @if (vm.canPick) {
            <!-- App de bureau : le champ ouvre le sélecteur natif, comme le bouton dossier. -->
            <input hlmInputGroupInput id="ns-dir" class="mono pick" readonly [value]="vm.chosen()" placeholder="Choisis un dossier"
              (click)="vm.pickFolder()" (keydown.enter)="$event.preventDefault(); vm.pickFolder()" (keydown.space)="$event.preventDefault(); vm.pickFolder()"
              aria-label="Dossier : choisir sur le disque" [aria-invalid]="cwdInvalid()" />
          } @else {
          <input hlmInputGroupInput id="ns-dir" class="mono" role="combobox" aria-controls="ns-dir-list" aria-expanded="true" aria-autocomplete="list" aria-describedby="ns-dir-hint"
            [attr.aria-activedescendant]="vm.activeId()" [value]="vm.query()" (input)="vm.setQuery($any($event.target).value)" (keydown)="vm.dirKey($event)"
            placeholder="Cherche un projet ou tape un chemin" autocomplete="off" spellcheck="false" [aria-invalid]="cwdInvalid()" />
          }
            @if (vm.canPick) {
              <hlm-input-group-addon align="inline-end">
                <button hlmInputGroupButton type="button" size="icon-xs" aria-label="Choisir un dossier sur le disque" title="Choisir un dossier (ou un projet Xcode)" (click)="vm.pickFolder()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12l4-8H8l-4 8" /></svg>
                </button>
              </hlm-input-group-addon>
            }
          </hlm-input-group>
          @if (!vm.canPick) {
          <span id="ns-dir-hint" class="sr-only">Flèches haut et bas pour choisir, Entrée pour sélectionner, Tab ou flèche droite pour parcourir un dossier, flèche gauche pour remonter.</span>
          @if (vm.crumbs().length) {
            <nav class="crumbs small" aria-label="Dossier parcouru">
              <button type="button" (click)="vm.setQuery('')">Récents</button>
              @for (c of vm.crumbs(); track c.path) {
                <svg appIcon="chevron" width="12" height="12"></svg>
                <button type="button" class="mono" (click)="vm.setQuery(c.path)">{{ c.label }}</button>
              }
            </nav>
          }
          <div class="list" #list>
            <ul id="ns-dir-list" role="listbox" [attr.aria-label]="vm.isPath() ? 'Sous-dossiers' : 'Dossiers récents'">
              @for (p of vm.rows(); track p.path; let i = $index) {
                @let picked = p.path === vm.chosen();
                <li [id]="'ns-dir-opt-' + i" role="option" class="row" [class.active]="i === vm.active()" [class.picked]="picked" [attr.aria-selected]="picked"
                  (mousedown)="$event.preventDefault()" (mouseenter)="vm.active.set(i)" (click)="vm.select(p)">
                  @if (picked) {
                    <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                  } @else {
                    <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  }
                  <span class="txt">
                    <span class="line">
                      <span class="name">@for (x of vm.parts(vm.base(p.path)); track $index) { @if (x.hit) { <mark>{{ x.text }}</mark> } @else { {{ x.text }} } }</span>
                      @if (p.kind) { <span hlmBadge variant="secondary" class="kind">{{ vm.kindLabel(p.kind) }}</span> }
                    </span>
                    <span class="sub mono">
                      <span class="parent">{{ vm.parent(p.path) }}</span>
                      @if (p.branch) {
                        <span class="branch"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M18 9a6 6 0 0 1-6 6H6" /></svg>{{ p.branch }}</span>
                      }
                    </span>
                  </span>
                  @if (p.lastTs !== null) { <span class="age mono">{{ vm.age(p.lastTs) }}</span> }
                  <button hlmBtn type="button" variant="ghost" size="icon-sm" class="go" tabindex="-1" [attr.aria-label]="'Parcourir ' + vm.base(p.path)" (click)="$event.stopPropagation(); vm.browse(p)">
                    <svg appIcon="chevron" width="16" height="16"></svg>
                  </button>
                </li>
              }
            </ul>
            @if (!vm.rows().length) { <p class="empty small" role="status">{{ vm.emptyText() }}</p> }
          </div>
          }
          @if (cwdInvalid()) { <span class="small text-err" role="alert">Choisis un dossier</span> }
        </div>

        <div class="field">
          <span hlmLabel id="ns-git">Git</span>
          <div hlmToggleGroup type="single" variant="outline" size="sm" [spacing]="2" aria-labelledby="ns-git" class="flex-wrap" [nullable]="false" [value]="vm.model().git" (valueChange)="vm.setGit($any($event))">
            @for (g of vm.gitModes; track g.value) {
              <button hlmToggleGroupItem [value]="g.value">{{ g.label }}</button>
            }
          </div>
          @if (vm.model().git !== 'current') {
            <input hlmInput id="ns-branch" class="mono" aria-label="Nom de la branche" [formField]="vm.form.branch" [placeholder]="vm.model().git === 'branch' ? 'feat/ma-branche' : 'nom du worktree (optionnel)'" autocomplete="off" spellcheck="false" [aria-invalid]="branchInvalid()" [attr.aria-required]="vm.model().git === 'branch'" />
            @if (branchInvalid()) { <span class="small text-err" role="alert">Nomme la branche</span> }
            <span class="small faint">
              @if (vm.model().git === 'branch') { Créée depuis la branche courante avec <span class="mono">git switch -c</span>, dans le dossier lui-même. }
              @else { Copie isolée dans <span class="mono">.claude/worktrees/</span>, sur une nouvelle branche : le dossier d'origine n'est pas touché. }
            </span>
          }
        </div>

        <div class="cols">
          <div class="field">
            <label hlmLabel for="ns-model">Modèle</label>
            <hlm-select [formField]="vm.form.model" [itemToString]="vm.modelLabel">
              <hlm-select-trigger buttonId="ns-model" class="w-full"><hlm-select-value /></hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (o of vm.models; track o.value) { <hlm-select-item [value]="o.value">{{ o.label }}</hlm-select-item> }
              </hlm-select-content>
            </hlm-select>
          </div>
          <div class="field">
            <label hlmLabel for="ns-perm">Autorisations</label>
            <hlm-select [formField]="vm.form.permission" [itemToString]="vm.permissionLabel">
              <hlm-select-trigger buttonId="ns-perm" class="w-full"><hlm-select-value /></hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (o of vm.permissions; track o.value) { <hlm-select-item [value]="o.value">{{ o.label }}</hlm-select-item> }
              </hlm-select-content>
            </hlm-select>
          </div>
        </div>

        <div class="field">
          <span hlmLabel id="ns-tpl">Gabarit</span>
          <div hlmToggleGroup type="single" variant="outline" size="sm" [spacing]="2" aria-labelledby="ns-tpl" class="flex-wrap" [nullable]="false" [value]="vm.model().template" (valueChange)="vm.setTemplate($any($event))">
            @for (t of vm.templates; track t.id) {
              <button hlmToggleGroupItem [value]="t.id">{{ t.label }}</button>
            }
          </div>
        </div>

        <div class="field">
          <label hlmLabel for="ns-cmd">Commande lancée dans le terminal</label>
          <hlm-input-group class="cmd">
            <hlm-input-group-addon class="mono">$</hlm-input-group-addon>
            <input hlmInputGroupInput id="ns-cmd" class="mono" [value]="vm.command()" (input)="vm.setCommand($any($event.target).value)" spellcheck="false" />
          </hlm-input-group>
          <span class="small faint">Un terminal s'ouvre dans l'app, dans <span class="mono">{{ vm.cwdLabel() }}</span>, et lance cette commande. Tu écris ensuite directement à Claude dedans, au clavier.</span>
        </div>

        @if (vm.error(); as error) { <p class="text-err" role="alert">{{ error }}</p> }

        <div class="foot">
          <a hlmBtn variant="outline" size="lg" routerLink="/">Annuler</a>
          <button hlmBtn size="lg" type="submit" [disabled]="vm.form().submitting()">Lancer la session <kbd hlmKbd>{{ vm.launchKey }}</kbd></button>
        </div>
      </form>
    </app-page>
  `,
  styles: `
    .backdrop { --page-pt: 64px; --page-px: 24px; --page-pb: 64px; background-color: var(--backdrop); }
    form { align-self: center; width: 100%; max-width: 640px; padding: 28px; gap: 20px; }
    /* Téléphone : le formulaire prend l'écran, sans marge perdue autour. */
    @media (max-width: 720px) {
      .backdrop { --page-pt: 16px; --page-px: 16px; --page-pb: 16px; min-height: calc(100dvh - var(--chrome-top)); }
      form { padding: 20px; }
    }
    .top { display: flex; justify-content: space-between; align-items: center; }
    h1 { font-size: 20px; font-weight: 600; }
    .field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .cmd { background: var(--bg-deep); }

    /* Liste des dossiers, dans le formulaire : nom en avant, chemin parent et branche en retrait, partie tapée surlignée. */
    .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; color: var(--faint); }
    .crumbs button { padding: 2px 6px; border-radius: 4px; color: var(--text-muted); transition: background var(--dur-fast) var(--ease); }
    .crumbs button:hover { background: var(--hover); color: var(--text); }
    .crumbs button:last-of-type { color: var(--text); }
    .pick { cursor: pointer; }
    /* Pas de défilement propre : la liste s'allonge, la page défile (un seul défilement, gabarit shell/page). */
    .list { padding: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-deep); }
    .row { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 4px 4px 10px; border-radius: 6px; cursor: pointer; transition: background var(--dur-fast) var(--ease); }
    .row.active { background: var(--hover); }
    .row.picked { background: var(--brand-bg); box-shadow: inset 2px 0 0 var(--brand); }
    .ico { flex: none; color: var(--faint); }
    .row.picked .ico, .row.active .ico { color: var(--brand); }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .line { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name mark { background: none; color: var(--brand); font-weight: 600; }
    .kind { height: 18px; font-size: 11px; }
    .sub { display: flex; gap: 10px; min-width: 0; font-size: 11px; color: var(--faint); }
    .parent { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
    .branch { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
    .branch svg { flex: none; }
    .age { flex: none; font-size: 11px; color: var(--faint); }
    .go { flex: none; color: var(--faint); }
    .empty { padding: 14px 10px; color: var(--text-muted); }
    .foot { display: flex; justify-content: flex-end; gap: 10px; padding-top: 16px; border-top: 1px solid var(--line); }
  `,
})
export class NewSessionComponent {
  protected readonly vm = inject(NewSessionVm);
  protected readonly cwdInvalid = computed(() => this.vm.form.cwd().touched() && this.vm.form.cwd().invalid());
  protected readonly branchInvalid = computed(() => this.vm.form.branch().touched() && this.vm.form.branch().invalid());

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Garde la ligne active visible quand on la déplace au clavier.
    afterRenderEffect(() => {
      const id = this.vm.activeId();
      if (id) this.list()?.nativeElement.querySelector(`#${id}`)?.scrollIntoView?.({ block: 'nearest' });
    });
  }
}
