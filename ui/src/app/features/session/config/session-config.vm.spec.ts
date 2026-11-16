import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { aConfig, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { VigieService } from '../../../core/vigie.service';
import { SessionConfigVm, auditCommand } from './session-config.vm';


describe('auditCommand', () => {
  it("lance claude en mode plan avec les constats du daemon, sans casser la commande shell", () => {
    const cmd = auditCommand(aConfig({ checks: [{ level: 'warning', area: 'Permissions', message: "« Bash(*) » autorise n'importe quoi" }] }).checks);
    expect(cmd.startsWith("claude --permission-mode plan '")).toBe(true);
    expect(cmd).toContain("[warning] Permissions : « Bash(*) » autorise n'\\''importe quoi");
    expect(cmd).toContain('Ne lis aucun fichier de secrets');
  });
});

describe('SessionConfigVm', () => {
  it("lance l'audit dans le dossier de la session et ouvre la nouvelle session", async () => {
    const startSession = vi.fn(async () => ({ sessionId: 'audit-1' }));
    TestBed.configureTestingModule({
      providers: [SessionConfigVm, provideRouter([]), provideVigieServiceMock({
        configResource: (() => fakeResource(aConfig())) as unknown as VigieService['configResource'],
        startSession: startSession as unknown as VigieService['startSession'],
      })],
    });
    const vm = TestBed.inject(SessionConfigVm);
    vm.connect(signal('s1'), signal('/Users/moi/dev/revu'));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(vm.counts()).toEqual({ error: 1, warning: 0, info: 0 });
    expect(vm.section()).toBe('issues'); // un problème : on ouvre « À corriger »
    vm.select('permissions');
    expect(vm.current()!.rows.map((r) => [r.title, r.meta])).toEqual([['Bash(npm test)', 'Autorisé'], ['Read(./.env*)', 'Interdit']]);
    // Toutes les rubriques restent visibles (leur état vide explique) ; « À corriger » seulement s'il y a un problème.
    expect(vm.sections().map((s) => s.key)).toEqual(['issues', 'instructions', 'skills', 'agents', 'commands', 'hooks', 'permissions', 'mcp', 'plugins', 'env']);
    // Légende des portées dans l'ordre de priorité, puis filtre ; un second clic revient à tout.
    expect(vm.scopes()).toEqual([{ scope: 'projet', count: 1 }, { scope: 'utilisateur', count: 1 }]);
    vm.setScope('utilisateur');
    expect(vm.current()!.rows.map((r) => r.title)).toEqual(['Read(./.env*)']);
    vm.setScope('projet');
    expect(vm.current()!.rows.map((r) => r.title)).toEqual(['Bash(npm test)']);
    vm.setScope('projet');
    expect(vm.scope()).toBeNull();
    await vm.audit();
    expect(startSession).toHaveBeenCalledWith({ cwd: '/Users/moi/dev/revu', command: expect.stringContaining('description manquante') });
    expect(navigate).toHaveBeenCalledWith(['/sessions', 'audit-1']);
    expect(vm.auditing()).toBe(false);
  });

  it("sans problème, « À corriger » disparaît et les instructions s'ouvrent, contenu lisible et coût estimé", () => {
    const instructions = [{ scope: 'projet' as const, path: '~/dev/revu/CLAUDE.md', lines: 40, bytes: 8400, imports: [{ ref: 'docs/a.md', ok: false }], body: '# Revu' }];
    TestBed.configureTestingModule({
      providers: [SessionConfigVm, provideRouter([]), provideVigieServiceMock({
        configResource: (() => fakeResource(aConfig({ instructions, checks: [{ level: 'info', area: 'Skills', message: 'note' }] }))) as unknown as VigieService['configResource'],
      })],
    });
    const vm = TestBed.inject(SessionConfigVm);
    vm.connect(signal('s1'), signal('/x'));
    expect(vm.sections()[0].key).toBe('instructions');
    expect(vm.section()).toBe('instructions');
    vm.select('issues'); // rubrique absente : on retombe sur les instructions
    expect(vm.section()).toBe('instructions');
    expect(vm.sections()[0].tokens).toBe(2100);
    const [row] = vm.current()!.rows;
    expect(row).toMatchObject({ tokens: 2100, long: true, imports: [{ ref: 'docs/a.md', ok: false }] });
    expect(row.html).toContain('<h1>Revu</h1>');
  });

  it('déplie une ligne pour afficher son markdown rendu, les autres restent fermées', () => {
    const skills = [
      { scope: 'projet' as const, name: 'revue', description: 'd', path: '~/dev/revu/SKILL.md', body: '# Revu\n\n- **tests** : `npm test`' },
      { scope: 'utilisateur' as const, name: 'autre', description: 'd', path: '~/.claude/SKILL.md', body: 'Profil' },
    ];
    TestBed.configureTestingModule({
      providers: [SessionConfigVm, provideRouter([]), provideVigieServiceMock({
        configResource: (() => fakeResource(aConfig({ skills, checks: [] }))) as unknown as VigieService['configResource'],
      })],
    });
    const vm = TestBed.inject(SessionConfigVm);
    vm.connect(signal('s1'), signal('/x'));
    vm.select('skills');
    expect(vm.current()!.rows.map((r) => r.html)).toEqual([undefined, undefined]);
    vm.toggle('~/dev/revu/SKILL.md', true);
    const [open, closed] = vm.current()!.rows;
    expect(open.html).toContain('<h1>Revu</h1>');
    expect(open.html).toContain('<strong>tests</strong>');
    expect(closed.html).toBeUndefined();
    vm.toggle('~/dev/revu/SKILL.md', false);
    expect(vm.current()!.rows[0].html).toBeUndefined();
  });

  it('agent déplié : description en markdown et outils un par un', () => {
    const agents = [
      { scope: 'projet' as const, name: 'revue', description: 'Relit **le diff**', tools: 'Read, Grep', model: null, path: '~/a/revue.md', body: 'corps' },
      { scope: 'projet' as const, name: 'libre', description: '', tools: null, model: null, path: '~/a/libre.md', body: '' },
    ];
    TestBed.configureTestingModule({
      providers: [SessionConfigVm, provideRouter([]), provideVigieServiceMock({
        configResource: (() => fakeResource(aConfig({ agents, checks: [] }))) as unknown as VigieService['configResource'],
      })],
    });
    const vm = TestBed.inject(SessionConfigVm);
    vm.connect(signal('s1'), signal('/x'));
    vm.select('agents');
    expect(vm.current()!.rows.map((r) => [r.tools, r.descHtml])).toEqual([[['Read', 'Grep'], undefined], [null, undefined]]);
    vm.toggle('~/a/revue.md', true);
    expect(vm.current()!.rows[0].descHtml).toContain('<strong>le diff</strong>');
  });
});
