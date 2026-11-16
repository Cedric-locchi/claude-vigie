import { describe, expect, it } from 'vitest';
import { duration, pct, tokens } from './format';

describe('format', () => {
  it('abrège les tokens', () => {
    expect(tokens(950)).toBe('950');
    expect(tokens(312_400)).toBe('312 k');
    expect(tokens(4_210_000)).toBe('4,2 M');
    expect(tokens(1_094_000_000)).toBe('1,1 G');
  });

  it('écrit les durées comme la maquette', () => {
    expect(duration(20_000)).toBe('< 1 min');
    expect(duration(6 * 60_000)).toBe('6 min');
    expect(duration(108 * 60_000)).toBe('1 h 48');
    expect(duration(120 * 60_000)).toBe('2 h');
  });

  it('arrondit les pourcentages', () => {
    expect(pct(0.624)).toBe('62 %');
  });
});
