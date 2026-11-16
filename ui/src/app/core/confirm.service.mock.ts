import { Provider } from '@angular/core';
import { vi } from 'vitest';
import { ConfirmService } from './confirm.service';

export function provideConfirmServiceMock(answer = true): Provider {
  return {
    provide: ConfirmService,
    useValue: {
      ask: vi.fn(async () => answer),
      deleteSession: vi.fn(async () => answer),
      deleteSessions: vi.fn(async () => answer),
      resumeSession: vi.fn(async () => answer),
      leaveChat: vi.fn(async () => answer),
      commit: vi.fn(async () => answer),
    } satisfies Partial<ConfirmService>,
  };
}
