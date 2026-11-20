import { InjectionToken } from '@angular/core';

/**
 * Point de plateforme de l'UI : l'OS du CLIENT (le navigateur), pas celui du daemon.
 * Sous WSL, le daemon tourne sous Linux mais l'UI peut être ouverte depuis un navigateur Windows.
 */
export type ClientOs = 'mac' | 'windows' | 'linux';

type Nav = Pick<Navigator, 'platform' | 'userAgent'>;

export function clientOs(nav: Nav): ClientOs {
  const p = nav.platform || nav.userAgent;
  if (/Mac|iPhone|iPad/.test(p)) return 'mac';
  if (/Win/.test(p)) return 'windows';
  return 'linux';
}

/** Commande qui relance le service du daemon (launchd ou systemd --user, voir bin/vigie.mjs) ; Linux aussi pour un navigateur Windows sur WSL. */
export const restartCommand = (os: ClientOs): string => (os === 'mac' ? 'launchctl kickstart -k gui/$UID/dev.vigie.daemon' : 'systemctl --user restart vigie');

/** OS du client, injectable pour que les tests simulent une autre plateforme. */
export const CLIENT_OS = new InjectionToken<ClientOs>('CLIENT_OS', { providedIn: 'root', factory: () => clientOs(navigator) });

/**
 * Raccourci « modificateur + touche » : Cmd sur mac, Ctrl ailleurs (hors mac, Meta = touche Windows/Super, prise par l'OS).
 * Rien d'autre d'enfoncé (Maj seulement si `shift`), pour ne pas voler Ctrl+Shift+F & co.
 */
export function isShortcut(e: KeyboardEvent, key: string, mac: boolean, shift = false): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && e.shiftKey === shift && e.key.toLowerCase() === key.toLowerCase();
}
