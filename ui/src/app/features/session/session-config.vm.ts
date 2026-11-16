import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ClaudeConfig, ConfigScope } from '../../core/models';
import { VigieService } from '../../core/vigie.service';
import { renderMarkdown } from '../../core/markdown';
import { SCOPE_ORDER, estimateTokens, splitMiddle } from './config-rules';

export type SectionKey = 'issues' | 'instructions' | 'skills' | 'agents' | 'commands' | 'hooks' | 'permissions' | 'mcp' | 'plugins' | 'env';

const SECTIONS: { key: SectionKey; label: string; area?: string; hint: string; empty: string }[] = [
  { key: 'issues', label: 'À corriger', hint: 'Ce que les vérifications rapides du daemon ont relevé.', empty: "Les vérifications rapides n'ont rien trouvé." },
  { key: 'instructions', label: 'Instructions', area: 'Instructions', hint: 'Fichiers CLAUDE.md chargés en entier au début de chaque session.', empty: 'Aucun CLAUDE.md : Claude ne connaît ni les conventions ni les commandes du projet. /init en génère un.' },
  { key: 'skills', label: 'Skills', area: 'Skills', hint: 'Savoir-faire que Claude charge quand la description correspond à la tâche.', empty: 'Aucune skill : Claude ne charge aucun savoir-faire à la demande.' },
  { key: 'agents', label: 'Agents', area: 'Agents', hint: 'Sous-agents spécialisés auxquels Claude peut déléguer.', empty: "Aucun sous-agent personnalisé : Claude ne délègue qu'à ses agents intégrés." },
  { key: 'commands', label: 'Commandes', area: 'Commandes', hint: 'Commandes slash personnalisées.', empty: 'Aucune commande slash personnalisée.' },
  { key: 'hooks', label: 'Hooks', area: 'Hooks', hint: 'Scripts lancés automatiquement sur des événements de Claude Code.', empty: "Aucun hook : Claude n'exécute rien automatiquement autour de ses outils." },
  { key: 'permissions', label: 'Permissions', area: 'Permissions', hint: "Ce que Claude peut faire sans demander, ce qu'il doit confirmer, ce qui est interdit.", empty: 'Aucune règle : Claude demande avant chaque action sensible.' },
  { key: 'mcp', label: 'Serveurs MCP', area: 'MCP', hint: 'Outils externes branchés à Claude.', empty: 'Aucun serveur MCP : Claude n\'utilise que ses outils intégrés.' },
  { key: 'plugins', label: 'Plugins', hint: 'Plugins Claude Code installés.', empty: 'Aucun plugin installé.' },
  { key: 'env', label: 'Environnement', hint: 'Variables définies dans les réglages (leurs valeurs ne sont jamais affichées).', empty: 'Aucune variable définie dans les réglages.' },
];

/** Une ligne de rubrique, quel que soit le type d'élément. */
export interface ConfigRow {
  id: string;
  title: string;
  /** Titre coupé en [début, fin] pour une troncature au milieu. */
  parts: [string, string];
  mono?: boolean;
  scope?: ConfigScope;
  /** Petit libellé à droite (nombre de lignes, modèle, type…). */
  meta?: string;
  /** Coût estimé en contexte, en tokens (instructions, skills, agents). */
  tokens?: number;
  description?: string;
  /** Description attendue mais absente : affichée comme un manque. */
  missing?: string;
  code?: string;
  path?: string;
  /** Imports d'un CLAUDE.md, avec leur état. */
  imports?: { ref: string; ok: boolean }[];
  /** Contenu plus long qu'un aperçu (instructions) : bouton « Tout afficher ». */
  long?: boolean;
  /** Markdown du fichier (instructions, skills, agents, commandes) : la ligne se déplie pour l'afficher. */
  body?: string;
  /** Markdown rendu : toujours pour les instructions, sinon seulement pour une ligne dépliée. */
  html?: string;
  /** Description rendue en markdown, seulement pour une ligne dépliée. */
  descHtml?: string;
  /** Outils d'un agent, un par puce ; null : il hérite de tous. */
  tools?: string[] | null;
  /** Pour rattacher les vérifications par nom (« nom »). */
  name?: string;
  issues: ClaudeConfig['checks'];
}

const PERMISSION_LABELS = { allow: 'Autorisé', ask: 'Demander', deny: 'Interdit', mode: 'Mode par défaut' } as const;
/** Ce qui reste en contexte pour une skill ou un agent : son nom et sa description (le corps est chargé à l'usage). */
const headCost = (x: { name: string; description: string }) => estimateTokens(x.name.length + x.description.length);
/** Aperçu des instructions, en lignes. */
export const PREVIEW_LINES = 12;

function toRows(c: ClaudeConfig): Record<Exclude<SectionKey, 'issues'>, ConfigRow[]> {
  const row = (r: Omit<ConfigRow, 'issues' | 'parts'>): ConfigRow => ({ ...r, parts: splitMiddle(r.title), issues: [] });
  return {
    instructions: c.instructions.map((i) => row({
      id: i.path, title: i.path, mono: true, scope: i.scope, path: i.path, meta: `${i.lines} lignes`, body: i.body,
      tokens: estimateTokens(i.bytes), imports: i.imports, long: i.lines > PREVIEW_LINES,
    })),
    skills: c.skills.map((k) => row({ id: k.path, title: k.name, name: k.name, scope: k.scope, path: k.path, body: k.body, tokens: headCost(k), description: k.description || undefined, missing: k.description ? undefined : 'Pas de description' })),
    agents: c.agents.map((a) => row({
      id: a.path, title: a.name, name: a.name, scope: a.scope, path: a.path, body: a.body, meta: a.model ?? undefined, tokens: headCost(a),
      description: a.description || undefined, missing: a.description ? undefined : 'Pas de description',
      tools: a.tools ? a.tools.split(',').map((t) => t.trim()).filter(Boolean) : null,
    })),
    commands: c.commands.map((k) => row({ id: k.path, title: k.name, name: k.name, mono: true, scope: k.scope, path: k.path, body: k.body, description: k.description || undefined })),
    hooks: c.hooks.map((h, i) => row({ id: `${h.scope}:${i}`, title: h.event, scope: h.scope, meta: h.matcher ?? undefined, code: h.command })),
    permissions: c.permissions.map((p, i) => row({ id: `${p.scope}:${i}`, title: p.rule, mono: true, scope: p.scope, meta: PERMISSION_LABELS[p.kind] })),
    mcp: c.mcp.map((m) => row({
      id: `${m.scope}:${m.name}`, title: m.name, name: m.name, scope: m.scope, meta: m.type, code: m.target,
      description: m.env.length ? `Variables : ${m.env.join(', ')}` : undefined,
    })),
    plugins: c.plugins.map((p) => row({ id: p.name, title: p.name, mono: true, meta: p.enabled ? 'actif' : 'désactivé' })),
    env: c.env.map((e) => row({ id: `${e.scope}:${e.name}`, title: e.name, mono: true, scope: e.scope })),
  };
}

/** Une vérification vise une ligne si elle porte sur son fichier ou la cite par son nom. */
function concerns(check: ClaudeConfig['checks'][number], row: ConfigRow): boolean {
  return (!!row.path && check.path === row.path) || (!!row.name && check.message.includes(`« ${row.name} »`)) || (!!row.title && check.message.includes(`« ${row.title} »`));
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Commande de l'audit approfondi : une session Claude en mode plan (lecture seule) dans le dossier,
 * qui part des constats du daemon pour aller plus loin.
 */
export function auditCommand(checks: ClaudeConfig['checks']): string {
  const known = checks.length
    ? `Le daemon Vigie a déjà relevé :\n${checks.map((c) => `- [${c.level}] ${c.area} : ${c.message}${c.path ? ` (${c.path})` : ''}`).join('\n')}\n\n`
    : '';
  const prompt =
    "Audite la configuration Claude Code qui s'applique à ce projet, sans rien modifier : CLAUDE.md (et ses imports), " +
    '.claude/settings.json et settings.local.json, skills, agents, commandes slash, hooks, permissions, serveurs MCP (.mcp.json), ' +
    "ainsi que ce qui vient de mon profil ~/.claude et s'applique ici.\n\n" +
    known +
    'Vérifie notamment : instructions manquantes, obsolètes ou contradictoires avec le code réel (commandes de build/test, conventions) ; ' +
    "skills et agents mal décrits, redondants ou dont la description ne dit pas quand s'en servir ; agents qui ont plus d'outils que nécessaire ; " +
    'hooks fragiles ; permissions trop larges ou trous de sécurité ; ce qui manque pour ce projet (skills, agents, commandes utiles).\n\n' +
    'Ne lis aucun fichier de secrets (.env, clés, credentials) et ne recopie aucun secret. ' +
    'Rends un rapport classé par gravité (bloquant, important, amélioration), avec pour chaque point le fichier concerné et le correctif proposé.';
  return `claude --permission-mode plan ${shQuote(prompt)}`;
}

@Injectable()
export class SessionConfigVm {
  private readonly vigie = inject(VigieService);
  private readonly router = inject(Router);
  private readonly source = signal<{ id: Signal<string>; cwd: Signal<string> } | null>(null);

  private readonly id = computed(() => this.source()?.id() ?? null);
  private readonly resource = this.vigie.configResource(this.id);
  readonly config = computed(() => (this.resource.hasValue() ? this.resource.value() : null));
  readonly loading = computed(() => this.resource.isLoading() && !this.config());
  readonly failed = computed(() => this.resource.status() === 'error');

  readonly counts = computed(() => {
    const checks = this.config()?.checks ?? [];
    return { error: checks.filter((c) => c.level === 'error').length, warning: checks.filter((c) => c.level === 'warning').length, info: checks.filter((c) => c.level === 'info').length };
  });

  /** Toutes les lignes, ramenées à une même forme : une rubrique = une liste simple. */
  private readonly allRows = computed(() => (this.config() ? toRows(this.config()!) : null));
  /** Portée filtrée (null : toutes). */
  readonly scope = signal<ConfigScope | null>(null);
  private readonly rows = computed(() => {
    const all = this.allRows();
    const scope = this.scope();
    if (!all || !scope) return all;
    return Object.fromEntries(Object.entries(all).map(([k, rs]) => [k, rs.filter((r) => !r.scope || r.scope === scope)])) as typeof all;
  });

  /** Toutes les rubriques, même vides (leur état vide explique ce que ça implique) ; « À corriger » seulement s'il y a quelque chose. */
  readonly sections = computed(() => {
    const c = this.config();
    if (!c) return [];
    const rows = this.rows()!;
    return SECTIONS.map(({ key, label, area }) => {
      const checks = key === 'issues' ? c.checks : c.checks.filter((k) => k.area === area);
      const own = key === 'issues' ? [] : rows[key];
      const withCost = own.filter((r) => r.tokens !== undefined);
      return {
        key, label,
        count: key === 'issues' ? checks.filter((k) => k.level !== 'info').length : own.length,
        tokens: withCost.length ? withCost.reduce((n, r) => n + r.tokens!, 0) : null,
        errors: checks.filter((k) => k.level === 'error').length,
        warnings: checks.filter((k) => k.level === 'warning').length,
      };
    }).filter((s) => s.key !== 'issues' || s.count);
  });

  /** Rubrique affichée ; par défaut « À corriger » s'il y a des problèmes, sinon les instructions. */
  private readonly chosen = signal<SectionKey | null>(null);
  readonly section = computed<SectionKey>(() => {
    const chosen = this.chosen();
    if (chosen && (chosen !== 'issues' || this.sections().some((s) => s.key === 'issues'))) return chosen;
    return this.sections().some((s) => s.key === 'issues') ? 'issues' : 'instructions';
  });

  /** Légende des portées de la rubrique, de la plus prioritaire à la moins prioritaire, avec leur nombre d'éléments. */
  readonly scopes = computed(() => {
    const key = this.section();
    const rows = key === 'issues' ? [] : (this.allRows()?.[key] ?? []);
    return SCOPE_ORDER.map((scope) => ({ scope, count: rows.filter((r) => r.scope === scope).length })).filter((s) => s.count);
  });

  /** Contenu de la rubrique : ses lignes, chacune avec ses problèmes ; ce qui ne vise aucune ligne passe en tête. */
  readonly current = computed(() => {
    const c = this.config();
    const key = this.section();
    if (!c) return null;
    const meta = SECTIONS.find((s) => s.key === key)!;
    const head = { key, label: meta.label, hint: meta.hint, empty: meta.empty };
    if (key === 'issues') return { ...head, general: c.checks, rows: [] as ConfigRow[] };
    const checks = c.checks.filter((k) => k.area === meta.area);
    const expanded = this.expanded();
    const rows = this.rows()![key].map((row) => {
      // Rendu à la demande : seules les lignes dépliées passent par marked ; les instructions sont toujours lisibles.
      const open = row.body !== undefined && (key === 'instructions' || expanded.has(row.id));
      return {
        ...row, issues: checks.filter((k) => concerns(k, row)),
        html: open ? renderMarkdown(row.body!) : undefined,
        descHtml: open && row.description ? renderMarkdown(row.description) : undefined,
      };
    });
    const general = checks.filter((k) => !rows.some((r) => r.issues.includes(k)));
    return { ...head, general, rows };
  });

  /** Lignes dépliées (id) ; pour les instructions, celles affichées en entier. Gardées en changeant de rubrique ou de filtre. */
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  toggle(id: string, open: boolean): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (open) next.add(id); else next.delete(id);
      return next;
    });
  }

  /** Bascule le filtre de portée : un second clic sur la même portée revient à tout. */
  setScope(scope: ConfigScope | null): void {
    this.scope.update((s) => (s === scope ? null : scope));
  }

  select(key: SectionKey): void {
    this.chosen.set(key);
  }

  readonly auditing = signal(false);
  readonly auditError = signal<string | null>(null);

  connect(id: Signal<string>, cwd: Signal<string>): void {
    this.source.set({ id, cwd });
  }

  reload(): void {
    this.resource.reload();
  }

  /** Lance l'audit approfondi dans une nouvelle session Vigie, puis l'ouvre. */
  async audit(): Promise<void> {
    const cwd = this.source()?.cwd();
    if (!cwd) return;
    this.auditing.set(true);
    this.auditError.set(null);
    try {
      const term = await this.vigie.startSession({ cwd, command: auditCommand(this.config()?.checks ?? []) });
      await this.router.navigate(['/sessions', term.sessionId]);
    } catch (e) {
      this.auditError.set((e as { error?: { error?: string } })?.error?.error ?? "Impossible de lancer l'audit.");
    } finally {
      this.auditing.set(false);
    }
  }
}
