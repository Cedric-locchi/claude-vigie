// Schémas du plugin Xcode (décision 037) : partagés par le back (./contract.mjs) et le front (../contract.mjs).
// Les regex sont communes : le front peut griser un bouton, le back refuse. zod/mini seulement : rien de Vigie ici.
import * as z from 'zod/mini';

const str = z.string();

// `name` relatif au cwd (« App.xcworkspace », « Package.swift ») ; `container` null = pas un projet iOS.
export const XcodeContainer = z.object({ kind: z.enum(['workspace', 'project', 'package']), name: str });
// `scripts` : noms des fichiers scripts/*.sh|*.py du cwd (fichiers ordinaires, non cachés).
export const XcodeProject = z.object({ container: z.nullable(XcodeContainer), scripts: z.array(str) });
export const Simulator = z.object({ udid: str, name: str, runtime: str, booted: z.boolean() }); // runtime « iOS 18.0 »
// `available` : faux sans Xcode (Linux, ou Mac avec les seuls Command Line Tools) ; `error` : message à montrer.
export const XcodeTargets = z.object({ available: z.boolean(), schemes: z.array(str), simulators: z.array(Simulator), error: z.nullable(str) });
export const XcodeAction = z.enum(['build', 'test', 'clean', 'run']);
// Méthode `open` (xed) : rien à rendre, la fenêtre d'Xcode s'ouvre.
export const XcodeOpen = z.null();

// Ni `\` ni `'` : sous fish, `\'` sortirait des guillemets simples de shQuote ; pas de `-` en tête (option de xcodebuild).
// eslint-disable-next-line no-control-regex -- refuser les caractères de contrôle est le but
export const SCHEME = /^(?!-)[^\x00-\x1f\x7f\\']{1,200}$/;
export const UDID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
export const SCRIPT = /^[\w.-]+\.(sh|py)$/;

const scheme = z.string({ error: 'Choisis un scheme' }).check(z.regex(SCHEME, 'Scheme invalide'));
const udid = z.string({ error: 'Choisis un simulateur' }).check(z.regex(UDID, 'Simulateur invalide'));
// Actions run, build, test : scheme + simulateur ; clean : scheme seul.
export const XcodeRunParams = z.object({ scheme, udid });
export const XcodeCleanParams = z.object({ scheme });
// Action script : nom d'un fichier de scripts/ (relu dans la liste par le back).
export const ScriptParams = z.object({ name: z.string({ error: 'Script invalide' }).check(z.regex(SCRIPT, 'Script invalide')) });
