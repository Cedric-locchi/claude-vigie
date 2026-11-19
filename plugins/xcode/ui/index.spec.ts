import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PluginHost } from '@vigie/plugin-sdk';
import { callReplies, fakePluginHost } from '@vigie/plugin-sdk/testing';
import { anXcodeProject, anXcodeTargets } from './fixtures';
import XcodeTabComponent from './index';
import type { XcodeTargets } from './models';

async function render(targets: XcodeTargets) {
  const host = fakePluginHost({ call: callReplies({ project: anXcodeProject(), targets }) });
  TestBed.configureTestingModule({ providers: [{ provide: PluginHost, useValue: host }] });
  const fixture = TestBed.createComponent(XcodeTabComponent);
  fixture.componentRef.setInput('sessionId', 's1');
  const el = fixture.nativeElement as HTMLElement;
  await vi.waitFor(() => { fixture.detectChanges(); expect(el.querySelector('h2')).not.toBeNull(); expect(el.textContent).not.toContain('Lecture du projet'); });
  return el;
}

describe('XcodeTabComponent', () => {
  it('en-tête, actions et scripts', async () => {
    const el = await render(anXcodeTargets());
    expect(el.querySelector('h2')!.textContent).toBe('App.xcworkspace');
    expect(el.querySelector('[hlmBadge]')!.textContent).toBe('Workspace');
    expect([...el.querySelectorAll('.actions button')].map((b) => b.textContent!.trim())).toEqual(['Lancer sur le simulateur', 'Build', 'Test', 'Clean']);
    expect([...el.querySelectorAll('.scripts .task')].map((b) => b.textContent)).toEqual(['bootstrap.sh', 'lint.py']);
  });

  it('Xcode indisponible : message, indice xcode-select, scripts toujours là', async () => {
    const el = await render(anXcodeTargets({ available: false, schemes: [], simulators: [], error: 'tool requires Xcode' }));
    expect(el.textContent).toContain('Xcode indisponible sur cette machine');
    expect(el.textContent).toContain('tool requires Xcode');
    expect(el.textContent).toContain('sudo xcode-select -s /Applications/Xcode.app');
    expect(el.querySelector('.actions')).toBeNull();
    expect(el.querySelectorAll('.scripts .task')).toHaveLength(2);
  });
});
