import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { aConfig, fakeResource, provideVigieServiceMock } from '../../../../core/vigie.service.mock';
import { VigieService } from '../../../../core/vigie.service';
import { ClaudeConfig } from '../../../../core/models';
import { ConfigPermissionsVm } from './config-permissions.vm';
import { SessionConfigVm } from '../session-config.vm';

function setup(permissions: ClaudeConfig['permissions']) {
  TestBed.configureTestingModule({
    providers: [SessionConfigVm, ConfigPermissionsVm, provideRouter([]), provideVigieServiceMock({
      configResource: (() => fakeResource(aConfig({ permissions, checks: [] }))) as unknown as VigieService['configResource'],
    })],
  });
  const parent = TestBed.inject(SessionConfigVm);
  parent.connect(signal('s1'), signal('/x'));
  return { parent, vm: TestBed.inject(ConfigPermissionsVm) };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ scope: 'organisation' as const, kind: 'allow' as const, rule: `mcp__k__outil_${i}` }));

describe('ConfigPermissionsVm', () => {
  it('résume par décision, filtre par décision (bascule), par recherche et par portée', () => {
    const { parent, vm } = setup([...many(3), { scope: 'projet', kind: 'ask', rule: 'Bash(git push:*)' }, { scope: 'projet', kind: 'deny', rule: 'Read(.env)' }, { scope: 'local', kind: 'mode', rule: 'plan' }]);
    expect(vm.summary().map((s) => s.count)).toEqual([3, 1, 1]);
    expect(vm.mode()).toBe('plan');
    vm.setKind('ask');
    expect(vm.groups().map((g) => g.label)).toEqual(['Bash']);
    vm.setKind('ask');
    expect(vm.kind()).toBeNull();
    vm.query.set('outil_1');
    expect(vm.groups().map((g) => [g.label, g.rules.length])).toEqual([['k', 1]]);
    vm.query.set('');
    parent.setScope('projet');
    expect(vm.summary().map((s) => s.count)).toEqual([0, 1, 1]);
  });

  it('un gros groupe démarre replié, s\'ouvre pendant une recherche ; un clic l\'emporte, l\'écho du toggle est ignoré', () => {
    const { vm } = setup(many(20));
    const open = () => vm.groups()[0].open;
    expect(open()).toBe(false);
    vm.toggle('mcp:k', false); // écho : rien ne change
    vm.query.set('outil');
    expect(open()).toBe(true);
    vm.toggle('mcp:k', true); // écho de l'ouverture par la recherche : ignoré
    vm.query.set('');
    expect(open()).toBe(false);
    vm.toggle('mcp:k', true); // clic
    expect(open()).toBe(true);
  });
});
