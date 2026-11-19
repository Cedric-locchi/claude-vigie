import { Component, inject, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PluginHost } from '@vigie/plugin-sdk';
import { provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { PluginTabComponent } from './plugin-tab.component';
import { PLUGIN_UI_TABLE } from './plugin-tab.vm';

@Component({ selector: 'fake-plugin', template: `<p class="probe">{{ sessionId() }} {{ host.cwd() }}</p>` })
class FakePlugin {
  readonly host = inject(PluginHost);
  readonly sessionId = input.required<string>();
}

describe('PluginTabComponent', () => {
  it('rend le composant du plugin avec PluginHost injecté et l’input sessionId', async () => {
    TestBed.configureTestingModule({ providers: [provideVigieServiceMock(), { provide: PLUGIN_UI_TABLE, useValue: { mise: async () => ({ default: FakePlugin }) } }] });
    const fixture = TestBed.createComponent(PluginTabComponent);
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('cwd', '/dev/app');
    fixture.componentRef.setInput('pluginId', 'mise');
    const el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(el.querySelector('.probe')?.textContent).toBe('s1 /dev/app');
    });
  });
});
