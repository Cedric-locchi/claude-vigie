import { DOCUMENT, DestroyRef, inject, signal } from '@angular/core';

/** Durée du retour « Copié ». */
export const COPIED_MS = 1500;

/**
 * Copie dans le presse-papiers, seule aide de l'app : `copied` vaut true 1,5 s après une copie réussie (le bouton dit « Copié »).
 * Presse-papiers absent ou refusé (permission, fenêtre sans focus) : rien ne change, le bouton reste tel quel.
 * À créer dans un contexte d'injection (champ d'un VM) : la minuterie est libérée avec lui.
 */
export function clipboardCopy() {
  const window = inject(DOCUMENT).defaultView;
  const copied = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));

  async function copy(text: string): Promise<void> {
    const clipboard = window?.navigator.clipboard;
    if (!clipboard) return;
    try {
      await clipboard.writeText(text);
    } catch {
      return;
    }
    copied.set(true);
    clearTimeout(timer);
    timer = setTimeout(() => copied.set(false), COPIED_MS);
  }

  return { copied: copied.asReadonly(), copy };
}
