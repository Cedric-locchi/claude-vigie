import { describe, expect, it } from 'vitest';
import { frame, heroMargins, leftFor } from './usage-charts';

describe('usage-charts', () => {
  it('marge gauche : contient la plus longue graduation, entre 36 et 96 px', () => {
    expect(leftFor(5, String)).toBe(36);
    expect(leftFor(123_456, String)).toBe(Math.ceil(6 * 6.5) + 12);
    expect(leftFor(1, () => '1'.repeat(40))).toBe(96);
  });

  it('marges du graphique héros : la droite contient la graduation du cumul, 30 px au moins', () => {
    const scale = { top: 40, left: [0, 20, 40], right: [0, 500, 1000], ratio: 0.04 };
    const m = heroMargins(scale, 'cost');
    expect(m.left).toBeGreaterThanOrEqual(36);
    expect(m.right).toBeGreaterThanOrEqual(30);
    expect(heroMargins({ ...scale, right: [0, 1] }, 'tokens').right).toBe(30);
  });

  it('gabarit : marges, police de l’app et couleurs par variables CSS (le SVG suit le thème)', () => {
    const fr = frame(400, 200, 40);
    expect(fr).toMatchObject({ width: 400, height: 200, marginLeft: 40, marginRight: 16, marginTop: 16, marginBottom: 28 });
    expect(fr.style).toContain('var(--text-muted)');
    expect(fr.style).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
