import { ClaudeConfig, ConfigScope } from '../../core/models';

/**
 * Logique pure de l'onglet Config : ordre des portées, coût estimé, regroupement et conflits des permissions.
 * Aucune dépendance Angular : testée telle quelle.
 */

/**
 * Portées de la plus prioritaire à la moins prioritaire, d'après la précédence des réglages de Claude Code :
 * politique gérée (organisation) > settings.local.json > settings.json du projet > ~/.claude.
 * « Parent » ne porte que des CLAUDE.md de dossiers parents (concaténés, pas de remplacement) : placé avant le profil.
 */
export const SCOPE_ORDER: readonly ConfigScope[] = ['organisation', 'local', 'projet', 'parent', 'utilisateur'];
export const SCOPE_LABEL: Record<ConfigScope, string> = { organisation: 'Organisation', local: 'Local', projet: 'Projet', parent: 'Parent', utilisateur: 'Global' };
export const SCOPE_HINT: Record<ConfigScope, string> = {
  organisation: 'Politique gérée par ton organisation, prioritaire sur tout le reste',
  local: 'Propre à toi dans ce projet (settings.local.json, CLAUDE.local.md), non partagé',
  projet: "Partagé avec l'équipe via le dépôt",
  parent: "Hérité d'un dossier parent",
  utilisateur: 'Ton profil ~/.claude, appliqué à tous tes projets',
};
const rank = (s: ConfigScope) => SCOPE_ORDER.indexOf(s);

/** Estimation grossière : ~4 octets (ou caractères) par token. Toujours affichée avec « ~ ». */
export const estimateTokens = (n: number): number => Math.round(n / 4);

/** Coupe un nom long en [début, fin] : le début se tronque à l'écran, la fin (souvent la partie utile) reste lisible. */
export function splitMiddle(s: string, tail = 16): [string, string] {
  return s.length <= tail * 2 ? [s, ''] : [s.slice(0, -tail), s.slice(-tail)];
}

export type Kind = ClaudeConfig['permissions'][number]['kind'];
export const KIND_LABEL: Record<Kind, string> = { deny: 'Interdit', ask: 'Demander', allow: 'Autorisé', mode: 'Mode' };
export const KIND_ORDER: readonly Kind[] = ['allow', 'ask', 'deny', 'mode'];

/** Répartition d'un groupe mixte, dans l'ordre Autorisé › Demander › Interdit : « 434 Autorisé · 13 Demander ». */
export function kindBreakdown(rules: { kind: Kind }[]): string {
  const n = new Map<Kind, number>();
  for (const r of rules) n.set(r.kind, (n.get(r.kind) ?? 0) + 1);
  return KIND_ORDER.filter((k) => n.get(k)).map((k) => `${n.get(k)} ${KIND_LABEL[k]}`).join(' · ');
}

/** Rapport d'une règle avec les autres règles identiques. */
export type RuleStatus = 'wins' | 'overridden' | 'duplicate' | null;
export interface Rule {
  scope: ConfigScope;
  kind: Kind;
  rule: string;
  status: RuleStatus;
  /** La règle qui l'emporte, quand celle-ci est remplacée ou en double. */
  by?: { scope: ConfigScope; kind: Kind };
}

const SEVERITY: Record<Kind, number> = { deny: 0, ask: 1, allow: 2, mode: 0 };

/**
 * Conflits entre règles au texte identique.
 * - allow / ask / deny : Claude Code fusionne les listes de toutes les portées et évalue deny, puis ask, puis allow ;
 *   la première qui correspond décide. Une même règle refusée quelque part l'emporte donc quelle que soit la portée.
 *   À décision égale, la copie de la portée la plus prioritaire est gardée, les autres sont « en double ».
 * - mode (defaultMode) : valeur simple, la portée la plus prioritaire remplace les autres.
 * ponytail: seul le texte exact est comparé ; le recouvrement de motifs (Bash(git:*) contre Bash(git push:*))
 * n'est pas tranché, faute de connaître exactement l'algorithme de correspondance de Claude Code.
 */
export function annotate(perms: ClaudeConfig['permissions']): Rule[] {
  const byKey = new Map<string, ClaudeConfig['permissions']>();
  for (const p of perms) {
    const key = p.kind === 'mode' ? 'mode' : 'r:' + p.rule;
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const winnerOf = new Map<string, ClaudeConfig['permissions'][number]>();
  for (const [key, list] of byKey) {
    if (list.length > 1) winnerOf.set(key, [...list].sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind] || rank(a.scope) - rank(b.scope))[0]);
  }
  return perms.map((p) => {
    const w = winnerOf.get(p.kind === 'mode' ? 'mode' : 'r:' + p.rule);
    if (!w) return { ...p, status: null };
    if (w === p) return { ...p, status: 'wins' };
    const status: RuleStatus = w.kind === p.kind && (p.kind !== 'mode' || w.rule === p.rule) ? 'duplicate' : 'overridden';
    return { ...p, status, by: { scope: w.scope, kind: w.kind } };
  });
}

export interface RuleGroup {
  key: string;
  label: string;
  mcp: boolean;
  rules: (Rule & { detail: string; parts: [string, string] })[];
  /** Portée / décision communes à toutes les règles du groupe, sinon null (affichées par ligne). */
  scope: ConfigScope | null;
  kind: Kind | null;
  conflicts: number;
}

/** Groupe d'une règle : `mcp__serveur__outil` → serveur, `Outil(motif)` → outil ; `detail` = ce qui reste à afficher. */
export function groupOf(p: { kind: Kind; rule: string }): { key: string; label: string; mcp: boolean; detail: string } {
  if (p.kind === 'mode') return { key: 'mode', label: 'Mode par défaut', mcp: false, detail: p.rule };
  const mcp = /^mcp__(.+?)(?:__(.+))?$/.exec(p.rule);
  if (mcp) return { key: 'mcp:' + mcp[1], label: mcp[1], mcp: true, detail: mcp[2] ?? 'tous les outils' };
  // Nom d'outil puis motif ; parenthèse finale tolérée absente (règle saisie à la main, motif tronqué).
  const m = /^([A-Za-z][\w.-]*)\((.*?)\)?$/s.exec(p.rule);
  if (m) return { key: 't:' + m[1], label: m[1], mcp: false, detail: m[2] };
  return { key: 't:' + p.rule, label: p.rule, mcp: false, detail: "tout l'outil" };
}

const same = <T>(xs: T[]): T | null => (xs.every((x) => x === xs[0]) ? xs[0] : null);

/** Regroupe : mode d'abord, puis les groupes en conflit, puis du plus gros au plus petit. */
export function groupRules(rules: Rule[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const r of rules) {
    const g = groupOf(r);
    const group = groups.get(g.key) ?? { key: g.key, label: g.label, mcp: g.mcp, rules: [], scope: null, kind: null, conflicts: 0 };
    group.rules.push({ ...r, detail: g.detail, parts: splitMiddle(g.detail) });
    groups.set(g.key, group);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      scope: same(g.rules.map((r) => r.scope)),
      kind: same(g.rules.map((r) => r.kind)),
      conflicts: g.rules.filter((r) => r.status === 'overridden').length,
    }))
    .sort((a, b) => +(b.key === 'mode') - +(a.key === 'mode') || +!!b.conflicts - +!!a.conflicts || b.rules.length - a.rules.length || a.label.localeCompare(b.label));
}

/** Filtres de la rubrique Permissions ; une portée ou une décision nulle laisse tout passer. */
export function filterRules(rules: Rule[], f: { scope: ConfigScope | null; kind: Kind | null; query: string }): Rule[] {
  const q = f.query.trim().toLowerCase();
  return rules.filter((r) => (!f.scope || r.scope === f.scope) && (!f.kind || r.kind === f.kind) && (!q || r.rule.toLowerCase().includes(q)));
}
