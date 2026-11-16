import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { provideVigieServiceMock } from '../../../core/vigie.service.mock';
import { VigieService } from '../../../core/vigie.service';
import { TerminalVm } from './terminal.vm';

type FakeSocket = { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void };

function createVm() {
  const socket = { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn() } as unknown as FakeSocket;
  const terminalSocket = vi.fn(() => socket);
  TestBed.configureTestingModule({ providers: [TerminalVm, provideVigieServiceMock({ terminalSocket: terminalSocket as unknown as VigieService['terminalSocket'] })] });
  return { vm: TestBed.inject(TerminalVm), socket, terminalSocket };
}

describe('TerminalVm', () => {
  it('se rattache au PTY et relaie la sortie', () => {
    const { vm, socket, terminalSocket } = createVm();
    const onData = vi.fn();
    vm.connect('t1', onData);
    expect(terminalSocket).toHaveBeenCalledWith('t1');
    expect(vm.status()).toBe('connecting');
    socket.onopen!();
    socket.onmessage!({ data: 'claude> ' });
    expect(vm.status()).toBe('open');
    expect(onData).toHaveBeenCalledWith('claude> ');
    socket.onclose!();
    expect(vm.status()).toBe('closed');
  });

  it('envoie les frappes et la taille au daemon', () => {
    const { vm, socket } = createVm();
    const pty = vm.connect('t1', () => {});
    pty.input('ls\r');
    pty.resize(132, 44);
    expect(socket.send.mock.calls.map(([m]) => JSON.parse(m as string))).toEqual([
      { type: 'input', data: 'ls\r' },
      { type: 'resize', cols: 132, rows: 44 },
    ]);
  });

  it('se reconnecte après une coupure et repart d’un écran vierge (le daemon rejoue le buffer)', () => {
    vi.useFakeTimers();
    try {
      const { vm, socket, terminalSocket } = createVm();
      const onData = vi.fn();
      vm.connect('t1', onData);
      socket.onopen!();
      socket.onclose!();
      expect(vm.status()).toBe('closed');
      vi.advanceTimersByTime(1000);
      expect(terminalSocket).toHaveBeenCalledTimes(2);
      socket.onopen!();
      expect(vm.status()).toBe('open');
      vm.dispose();
      socket.onclose!();
      vi.advanceTimersByTime(10_000);
      expect(terminalSocket).toHaveBeenCalledTimes(2); // fermé volontairement : plus d'essai
    } finally {
      vi.useRealTimers();
    }
  });
});
