import type { XcodeProject, XcodeTargets } from './models';

// Données factices des specs (pures, sans vitest : ce fichier est dans le programme de l'app, jamais importé par elle).

export function anXcodeProject(overrides: Partial<XcodeProject> = {}): XcodeProject {
  return { container: { kind: 'workspace', name: 'App.xcworkspace' }, scripts: ['bootstrap.sh', 'lint.py'], ...overrides };
}

/** Deux schemes, trois simulateurs sur deux runtimes, le second démarré. */
export function anXcodeTargets(overrides: Partial<XcodeTargets> = {}): XcodeTargets {
  return {
    available: true, error: null,
    schemes: ['App', 'AppTests'],
    simulators: [
      { udid: '11111111-1111-1111-1111-111111111111', name: 'iPhone 16', runtime: 'iOS 18.0', booted: false },
      { udid: '22222222-2222-2222-2222-222222222222', name: 'iPhone 16 Pro', runtime: 'iOS 18.0', booted: true },
      { udid: '33333333-3333-3333-3333-333333333333', name: 'iPhone 15', runtime: 'iOS 17.5', booted: false },
    ],
    ...overrides,
  };
}
