import { describe, expect, it } from 'vitest';
import { errorMessage, launcher } from './launcher';

describe('launcher', () => {
  it('un lancement à la fois ; un échec donne le message du host, sinon le repli', async () => {
    const l = launcher();
    let done!: () => void;
    const first = l.run('a', () => new Promise<void>((r) => (done = r)), 'repli');
    expect(l.launching()).toBe('a');
    let second = false;
    await l.run('b', async () => { second = true; }, 'repli'); // ignoré : « a » est en cours
    expect(second).toBe(false);
    done();
    await first;
    expect([l.launching(), l.error()]).toEqual([null, null]);
    await l.run('', async () => { throw new Error('Tâche inconnue'); }, 'repli'); // id vide accepté (mise trust)
    expect([l.launching(), l.error()]).toEqual([null, 'Tâche inconnue']);
    await l.run('c', async () => { throw { status: 500 }; }, 'Impossible de lancer.');
    expect(l.error()).toBe('Impossible de lancer.');
  });

  it("message d'erreur : celui de l'erreur s'il existe, sinon le repli", () => {
    expect([errorMessage(new Error('x'), 'r'), errorMessage(new Error(''), 'r'), errorMessage(undefined, 'r'), errorMessage({ message: 3 }, 'r')]).toEqual(['x', 'r', 'r', 'r']);
  });
});
