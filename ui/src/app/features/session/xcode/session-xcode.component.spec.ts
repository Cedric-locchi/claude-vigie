import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { XcodeTargets } from '../../../core/models';
import { VigieService } from '../../../core/vigie.service';
import { anXcodeProject, anXcodeTargets, fakeResource, provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { SessionXcodeComponent } from './session-xcode.component';

function render(targets: XcodeTargets) {
  TestBed.configureTestingModule({ providers: [provideVigieServiceMock({ xcodeTargetsResource: (() => fakeResource(targets)) as unknown as VigieService['xcodeTargetsResource'] })] });
  const fixture = TestBed.createComponent(SessionXcodeComponent);
  fixture.componentRef.setInput('sessionId', 's1');
  fixture.componentRef.setInput('cwd', '/render');
  fixture.componentRef.setInput('project', anXcodeProject());
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('SessionXcodeComponent', () => {
  it('en-tête, actions et scripts', () => {
    const el = render(anXcodeTargets());
    expect(el.querySelector('h2')!.textContent).toBe('App.xcworkspace');
    expect(el.querySelector('[hlmBadge]')!.textContent).toBe('Workspace');
    expect([...el.querySelectorAll('.actions button')].map((b) => b.textContent!.trim())).toEqual(['Lancer sur le simulateur', 'Build', 'Test', 'Clean']);
    expect([...el.querySelectorAll('.scripts .task')].map((b) => b.textContent)).toEqual(['bootstrap.sh', 'lint.py']);
  });

  it('Xcode indisponible : message, indice xcode-select, scripts toujours là', () => {
    const el = render(anXcodeTargets({ available: false, schemes: [], simulators: [], error: 'tool requires Xcode' }));
    expect(el.textContent).toContain('Xcode indisponible sur cette machine');
    expect(el.textContent).toContain('tool requires Xcode');
    expect(el.textContent).toContain('sudo xcode-select -s /Applications/Xcode.app');
    expect(el.querySelector('.actions')).toBeNull();
    expect(el.querySelectorAll('.scripts .task')).toHaveLength(2);
  });
});
