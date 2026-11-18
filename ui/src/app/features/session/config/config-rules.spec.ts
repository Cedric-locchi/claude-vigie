import { describe, expect, it } from 'vitest';
import { annotate, estimateTokens, filterRules, groupOf, groupRules, kindBreakdown, splitMiddle } from './config-rules';

describe('config-rules', () => {
  it('estime ~4 octets par token et coupe un nom long au milieu', () => {
    expect(estimateTokens(8400)).toBe(2100);
    expect(splitMiddle('court')).toEqual(['court', '']);
    const [head, tail] = splitMiddle('mcp__kartographe__accounts_get_by_identifier', 10);
    expect(tail).toBe('identifier');
    expect(head + tail).toBe('mcp__kartographe__accounts_get_by_identifier');
  });

  it('groupe par serveur MCP (même avec des _ simples), par outil, et le mode à part', () => {
    expect(groupOf({ kind: 'allow', rule: 'mcp__claude_ai_Docs__search' })).toEqual({ key: 'mcp:claude_ai_Docs', label: 'claude_ai_Docs', mcp: true, detail: 'search' });
    expect(groupOf({ kind: 'allow', rule: 'mcp__docs' })).toMatchObject({ key: 'mcp:docs', detail: 'tous les outils' });
    expect(groupOf({ kind: 'ask', rule: 'Bash(git push:*)' })).toMatchObject({ key: 't:Bash', label: 'Bash', detail: 'git push:*' });
    expect(groupOf({ kind: 'allow', rule: 'Read' })).toMatchObject({ key: 't:Read', detail: "tout l'outil" });
    // Parenthèse finale absente ou motif à plusieurs lignes : reste dans le groupe de l'outil.
    expect(groupOf({ kind: 'ask', rule: 'Bash(gws auth login' })).toMatchObject({ key: 't:Bash', detail: 'gws auth login' });
    expect(groupOf({ kind: 'ask', rule: 'Bash(a\nb)' })).toMatchObject({ key: 't:Bash', detail: 'a\nb' });
    expect(groupOf({ kind: 'mode', rule: 'acceptEdits' })).toMatchObject({ key: 'mode', detail: 'acceptEdits' });
  });

  it("conflits : deny > ask > allow quelle que soit la portée ; à décision égale, en double ; le mode suit la portée", () => {
    const rules = annotate([
      { scope: 'organisation', kind: 'ask', rule: 'Bash(git push:*)' },
      { scope: 'projet', kind: 'allow', rule: 'Bash(git push:*)' },
      { scope: 'utilisateur', kind: 'deny', rule: 'Bash(rm:*)' },
      { scope: 'organisation', kind: 'allow', rule: 'Bash(rm:*)' },
      { scope: 'projet', kind: 'allow', rule: 'Read' },
      { scope: 'utilisateur', kind: 'allow', rule: 'Read' },
      { scope: 'utilisateur', kind: 'mode', rule: 'plan' },
      { scope: 'local', kind: 'mode', rule: 'acceptEdits' },
      { scope: 'projet', kind: 'allow', rule: 'Grep' },
    ]);
    expect(rules.map((r) => [r.rule, r.status, r.by?.scope ?? null])).toEqual([
      ['Bash(git push:*)', 'wins', null],
      ['Bash(git push:*)', 'overridden', 'organisation'],
      ['Bash(rm:*)', 'wins', null],
      ['Bash(rm:*)', 'overridden', 'utilisateur'],
      ['Read', 'wins', null],
      ['Read', 'duplicate', 'projet'],
      ['plan', 'overridden', 'local'],
      ['acceptEdits', 'wins', null],
      ['Grep', null, null],
    ]);
  });

  it('conflits par recouvrement de préfixe : la règle étroite est remplacée ou en double, la large jamais', () => {
    const rules = annotate([
      { scope: 'projet', kind: 'deny', rule: 'Bash(git:*)' },
      { scope: 'projet', kind: 'allow', rule: 'Bash(git push:*)' },
      { scope: 'projet', kind: 'allow', rule: 'Bash(gitk)' },
      { scope: 'projet', kind: 'allow', rule: 'Bash(npm:*)' },
      { scope: 'utilisateur', kind: 'allow', rule: 'Bash(npm test)' },
      { scope: 'projet', kind: 'allow', rule: 'Edit' },
      { scope: 'projet', kind: 'ask', rule: 'Edit(src/a.ts)' },
      { scope: 'projet', kind: 'allow', rule: 'Read(src/**)' },
      { scope: 'projet', kind: 'allow', rule: 'Read(src/a.ts)' },
    ]);
    expect(rules.map((r) => [r.rule, r.status, r.by ? `${r.by.kind}/${r.by.scope}` : null])).toEqual([
      ['Bash(git:*)', null, null],
      ['Bash(git push:*)', 'overridden', 'deny/projet'],
      ['Bash(gitk)', null, null], // « git » ne recouvre pas « gitk »
      ['Bash(npm:*)', null, null],
      ['Bash(npm test)', 'duplicate', 'allow/projet'],
      ['Edit', null, null],
      ['Edit(src/a.ts)', null, null], // ask étroit plus strict que allow large
      ['Read(src/**)', null, null],
      ['Read(src/a.ts)', null, null], // motifs de chemin non comparés
    ]);
  });

  it('regroupe (mode, conflits, puis taille), factorise portée et décision homogènes, filtre', () => {
    const rules = annotate([
      { scope: 'organisation', kind: 'allow', rule: 'mcp__k__a' },
      { scope: 'organisation', kind: 'allow', rule: 'mcp__k__b' },
      { scope: 'organisation', kind: 'allow', rule: 'mcp__k__c' },
      { scope: 'projet', kind: 'allow', rule: 'Bash(ls)' },
      { scope: 'organisation', kind: 'deny', rule: 'Bash(ls)' },
      { scope: 'local', kind: 'mode', rule: 'plan' },
    ]);
    const groups = groupRules(rules);
    expect(groups.map((g) => [g.label, g.rules.length, g.scope, g.kind, g.conflicts])).toEqual([
      ['Mode par défaut', 1, 'local', 'mode', 0],
      ['Bash', 2, null, null, 1],
      ['k', 3, 'organisation', 'allow', 0],
    ]);
    expect(filterRules(rules, { scope: 'projet', kind: null, query: '' }).map((r) => r.rule)).toEqual(['Bash(ls)']);
    expect(filterRules(rules, { scope: null, kind: 'deny', query: '' })).toHaveLength(1);
    expect(filterRules(rules, { scope: null, kind: null, query: ' MCP__K__B ' }).map((r) => r.rule)).toEqual(['mcp__k__b']);
  });
});

describe('kindBreakdown', () => {
  it('compte les décisions d’un groupe mixte dans l’ordre Autorisé › Demander › Interdit', () => {
    expect(kindBreakdown([{ kind: 'ask' }, { kind: 'allow' }, { kind: 'allow' }, { kind: 'deny' }])).toBe('2 Autorisé · 1 Demander · 1 Interdit');
  });
});
