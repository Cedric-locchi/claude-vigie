// Contrat daemon ↔ UI en schémas zod : source unique (décision 004). ui/src/app/core/models.ts n'en contient que des z.infer.
// Sert au daemon à valider ses entrées et aux tests à vérifier ses sorties, à l'UI à valider tout ce qu'elle reçoit.
// Toujours `zod/mini` : `import { z } from 'zod'` tire l'API chaînable complète (~454 Ko) dans l'app empaquetée.
// Côté daemon, seul transport.mjs l'importe (chemin relatif) ; jamais hook.mjs ni statusline.mjs,
// qui tournent depuis app.asar.unpacked/daemon où ../contract n'existe pas.
import * as z from 'zod/mini';

const str = z.string();
const num = z.number();
const bool = z.boolean();
const nstr = z.nullable(str);
const nnum = z.nullable(num);

// ── Base ──────────────────────────────────────────────────────────────────
export const SessionState = z.enum(['waiting', 'turn', 'running', 'done']);
export const Reason = z.enum(['permission', 'question']);

// ── Snapshot (sans le `type: 'snapshot'` ajouté au message WebSocket) ────
export const SessionSummary = z.object({
  id: str,
  project: str,
  cwd: str,
  branch: nstr,
  model: nstr,
  title: str,
  lastText: str,
  tool: nstr,
  toolPath: nstr, // chemin complet du fichier visé par l'outil en cours, null hors outil à fichier
  state: SessionState,
  reason: z.optional(Reason),
  detail: z.optional(str),
  subagents: num,
  activeSubagents: num,
  tokens: num,
  cost: num,
  activity: z.array(num),
  firstTs: num,
  lastTs: num,
  terminalId: nstr,
});

export const Terminal = z.object({
  id: str,
  sessionId: str,
  kind: z.enum(['claude', 'shell']),
  title: str,
  cwd: str,
  shell: str,
  pid: num,
  cols: num,
  rows: num,
  exited: bool,
  startedAt: num,
});

export const UsageWindow = z.object({
  active: bool,
  real: z.optional(bool),
  weekPct: z.optional(nnum),
  readAt: z.optional(num),
  pct: num,
  tokens: num,
  start: nnum,
  end: nnum,
  projectedPct: num,
  limitAt: nnum,
});

export const Usage = z.object({
  window: UsageWindow,
  today: z.object({ tokens: num, cost: num, cacheRate: num }),
});

/** Statut public de Claude (status.claude.com), relevé par le daemon toutes les 5 min (décision 024). */
export const ClaudeStatus = z.object({
  indicator: z.enum(['none', 'minor', 'major', 'critical', 'maintenance', 'unknown']),
  incidents: z.array(z.object({ name: str, url: str })),
});

export const Snapshot = z.object({
  now: num,
  sessions: z.array(SessionSummary),
  usage: Usage,
  terminals: z.array(Terminal),
  // Absent jusqu'au premier relevé ; 'unknown' en cas d'échec.
  claudeStatus: z.optional(ClaudeStatus),
  plugins: z.array(str), // ids des plugins actifs (décision 034)
});

// ── Détail d'une session ──────────────────────────────────────────────────
export const ToolBar = z.object({
  name: str,
  kind: z.enum(['read', 'edit', 'command', 'agent', 'other']),
  label: str,
  start: num,
  end: nnum,
  error: bool,
});

export const Agent = z.object({
  id: str,
  name: str,
  sub: bool,
  description: str,
  state: SessionState,
  reason: z.optional(Reason),
  detail: z.optional(str),
  issue: z.optional(str),
  lastAction: nstr,
  lastText: str,
  lastTextTruncated: bool, // vrai si lastText est coupé à 20 000 caractères
  tokens: num,
  toolCount: num,
  firstTs: num,
  lastTs: num,
  bars: z.array(ToolBar),
  cost: num, // coût estimé de cet agent, en $
});

export const SessionUsage = z.object({
  input: num,
  output: num,
  cacheCreate: num,
  cacheRead: num,
  calls: num,
  context: num,
  contextMax: num,
});

export const SessionDetail = z.object({
  summary: SessionSummary,
  agents: z.array(Agent),
  timeline: z.object({ start: num, end: num }),
  usage: SessionUsage,
});

// ── Consommation (GET /api/usage) ─────────────────────────────────────────
export const UsageRow = z.object({
  day: num,
  sessionId: str,
  title: str,
  project: str,
  model: str,
  input: num,
  output: num,
  cacheCreate: num,
  cacheRead: num,
  cost: num,
});

// Fenêtre de 5 h close (historique) : `pct` = plus haut % réel relevé par la statusline pendant la fenêtre, null sans relevé.
export const QuotaBlock = z.object({ start: num, end: num, tokens: num, cost: num, pct: nnum });

export const UsageRows = z.object({ now: num, since: num, rows: z.array(UsageRow), windows: z.array(QuotaBlock) });

// ── Coût d'une session au fil du temps (GET /api/sessions/:id/cost) ───────
// Non cumulé : un point par agent (`agent` = Agent.id) et par pas de `step` ms où il a consommé ; ≤ 500 points par agent.
export const SessionCost = z.object({
  step: num,
  points: z.array(z.object({ ts: num, agent: str, cost: num, tokens: num })),
});

// ── Journal (GET /api/sessions/:id/log) ──────────────────────────────────
export const LogKind = z.enum(['prompt', 'assistant', 'thinking', 'tool', 'result', 'error', 'system']);

export const LogEntry = z.object({
  id: str,
  ts: num,
  kind: LogKind,
  title: str,
  text: str,
  truncated: bool,
  agent: str,
  sub: bool,
  ref: z.optional(str),
});

// Pas d'interface dans models.ts : forme inline de VigieService.sessionLog.
export const SessionLog = z.object({ entries: z.array(LogEntry) });

// ── Config Claude Code (GET /api/sessions/:id/config) ─────────────────────
export const ConfigScope = z.enum(['organisation', 'utilisateur', 'projet', 'local', 'parent']);

/** Typé pour que z.infer garde les champs côté UI (allowJs). @template {import('zod/mini').ZodMiniRawShape} S @param {S} shape */
const scoped = (shape) => z.object({ scope: ConfigScope, ...shape });
export const ClaudeConfig = z.object({
  cwd: str,
  model: nstr,
  settings: z.array(scoped({ path: str })),
  instructions: z.array(scoped({ path: str, lines: num, bytes: num, imports: z.array(z.object({ ref: str, ok: bool })), body: str })),
  skills: z.array(scoped({ name: str, description: str, path: str, body: str })),
  agents: z.array(scoped({ name: str, description: str, tools: nstr, model: nstr, path: str, body: str })),
  commands: z.array(scoped({ name: str, description: str, path: str, body: str })),
  hooks: z.array(scoped({ event: str, matcher: nstr, command: str })),
  permissions: z.array(scoped({ kind: z.enum(['allow', 'ask', 'deny', 'mode']), rule: str })),
  mcp: z.array(scoped({ name: str, type: str, target: str, env: z.array(str), path: z.optional(str) })),
  plugins: z.array(z.object({ name: str, enabled: bool })),
  env: z.array(scoped({ name: str })),
  checks: z.array(z.object({ level: z.enum(['error', 'warning', 'info']), area: str, message: str, path: z.optional(str) })),
});

// ── Trace (GET /api/sessions/:id/trace) ───────────────────────────────────
export const TraceStep = z.object({
  id: str,
  name: str,
  kind: ToolBar.shape.kind,
  label: str,
  // Chemin du fichier tel que donné à l'outil (file_path / notebook_path, absolu le plus souvent) ;
  // absent pour les outils sans fichier. `label` n'en garde que la fin, ambiguë.
  path: z.optional(str),
  start: num,
  end: nnum,
  error: bool,
  interrupted: bool, // toujours émis par trace.mjs (Échap, ou sans résultat dans une session terminée)
});

export const TraceAgent = z.object({
  id: str,
  name: str,
  description: str,
  state: SessionState,
  steps: z.array(TraceStep),
});

export const TraceTurn = z.object({
  index: num,
  start: num,
  end: num,
  prompt: str,
  live: bool,
  steps: z.array(z.extend(TraceStep, { agent: z.nullable(TraceAgent) })),
});

export const SessionTrace = z.object({
  now: num,
  state: SessionState,
  waiting: z.nullable(z.object({ reason: Reason, detail: str })),
  turns: z.array(TraceTurn),
});

// ── Git (GET /api/sessions/:id/git) ───────────────────────────────────────
export const GitFile = z.object({
  path: str,
  from: z.optional(str),
  status: z.enum(['M', 'A', 'D', 'R', '?']),
  staged: bool,
  unstaged: bool,
  added: num,
  removed: num,
  patch: str,
  truncated: bool,
});

export const GitDiff = z.object({
  cwd: str,
  repo: bool,
  root: nstr,
  branch: nstr,
  files: z.array(GitFile),
  total: num,
});

// Fichier ouvert pour édition (GET /api/sessions/:id/git/file?path=… ou …/files/read?path=…) ; `hash` : sha256 hex des octets sur disque,
// à renvoyer tel quel avec l'écriture (POST …/git/write) pour refuser d'écraser une modification survenue entre-temps.
export const FileBody = z.object({ path: str, content: str, hash: str });

// Fichiers du projet d'une session (GET /api/sessions/:id/files) : chemins relatifs à `root` (racine du dépôt, sinon cwd), liste plate non triée.
// `collapsed` : dossiers listés sans leur contenu (ignorés par git, node_modules, .git), sans `/` final ; `truncated` au-delà de 20 000 entrées.
// Lecture et écriture d'un fichier : GET …/files/read?path=… (FileBody) et POST …/files/write (WriteBody).
export const ProjectFiles = z.object({ root: str, repo: bool, files: z.array(str), collapsed: z.array(str), truncated: bool });
// Recherche texte (GET …/files/search) : une entrée par ligne trouvée (première occurrence de la ligne). line/col à partir de 1,
// col en unités UTF-16 sur la ligne d'origine. text : extrait ≤ 200 caractères autour de la colonne ; at : position du texte
// trouvé dans text. truncated : arrêt à 2 000 lignes ou liste de fichiers coupée.
export const SearchMatch = z.object({ line: num, col: num, text: str, at: num });
export const SearchFile = z.object({ path: str, matches: z.array(SearchMatch) });
export const SearchResults = z.object({ files: z.array(SearchFile), truncated: bool });

// ── Projets (GET /api/projects?q=) ────────────────────────────────────────
// q sans séparateur de chemin : dossiers récents (30). q = chemin : ses sous-dossiers non cachés qui commencent par le dernier segment (50 max).
// `path` en ~/… (nom et parent déduits par l'UI) ; `kind` : premier marqueur trouvé à la racine ;
// `branch` : .git/HEAD du dossier lui-même (null hors dépôt ou HEAD détachée) ; `lastTs` : dernier transcript dont c'est le cwd (ms), null si aucun.
export const ProjectKind = z.enum(['ios', 'node', 'rust', 'go', 'python', 'java']);
export const Project = z.object({ path: str, kind: z.nullable(ProjectKind), branch: nstr, lastTs: nnum });
export const Projects = z.array(Project);

// ── Petites réponses ──────────────────────────────────────────────────────
export const CommitSuggestion = z.object({ message: str }); // POST …/git/commit-message
export const ErrorBody = z.object({ error: str }); // toute réponse d'erreur du daemon (4xx, 5xx)

// ── Réglages du daemon (GET /api/settings) ──────────────────────────────
// Seuils d'alerte (stockés seulement) : `dailyCost` en $ par jour, `windowPct` en fraction de la fenêtre de 5 h ; null = pas d'alerte.
export const Alerts = z.object({
  dailyCost: z.nullable(z.number({ error: 'Le seuil de coût doit être un nombre' }).check(z.positive('Le seuil de coût doit être positif'), z.lte(100_000, 'Seuil de coût trop élevé (100 000 $ max)'))),
  windowPct: z.nullable(z.number({ error: 'Le seuil de fenêtre doit être un nombre' }).check(z.positive('Entre 1 et 100 %'), z.lte(1, 'Entre 1 et 100 %'))),
}, { error: 'Seuils d’alerte invalides' });

// `locale` : choisie dans Vigie (null = automatique) ; `defaultLocale` : celle qu'auraient les terminaux sans choix.
export const Settings = z.object({ locale: nstr, defaultLocale: str, alerts: Alerts });

// ── Plugins (décisions 034, 037) : socle seulement ; les schémas propres à un plugin vivent dans plugins/<id>/contract.mjs ──
// Le front d'un plugin est un composant Angular (décision 037) : plus de vue déclarative. La réponse d'une méthode (`call`)
// n'a pas de schéma ici : le front la valide avec le schéma du plugin.
const pname = z.string().check(z.regex(/^[\w-]{1,64}$/));
const ptext = z.string().check(z.maxLength(2000));
// GET /api/plugins : `error` = chargement impossible (API non supportée, erreur à l'import), affiché sur la carte.
export const PluginInfo = z.object({ id: str, name: str, description: str, enabled: bool, error: nstr });
export const Plugins = z.array(PluginInfo);
// GET /api/sessions/:id/plugins : plugins actifs dont `detect` est vrai pour le dossier de la session.
export const SessionPlugin = z.object({ id: str, name: str, badge: z.optional(str) });
export const SessionPlugins = z.array(SessionPlugin);
// POST …/plugins/:pid/actions/:aid : terminal ouvert (201).
export const PluginActionResult = z.object({ terminal: Terminal });

// ── Entrées (corps POST et messages /pty) ─────────────────────────────────
// Messages en français fixés ici plutôt que z.locales.fr() : l'UI importe aussi ce module, pas de config globale.
// Le transport renvoie le premier message tel quel (prettifyError ajoute « → at … »).
const body = { error: 'Corps de requête invalide' };
const text = (error) => z.string({ error });
export const NewSessionBody = z.object({
  cwd: text('Choisis un dossier').check(z.minLength(1, 'Choisis un dossier')),
  command: z.optional(text('La commande doit être un texte')),
}, body);
// Champs absents : inchangés (on n'envoie que ce qu'on modifie).
export const SettingsBody = z.object({
  locale: z.optional(z.nullable(text('La locale doit être un texte').check(z.regex(/^[A-Za-z0-9_.@-]{1,64}$/, 'Locale invalide (ex. fr_FR.UTF-8)')))),
  alerts: z.optional(Alerts),
}, body);
// Nom de branche ou de worktree : pas d'espace, pas de tiret en tête (option git), le reste est vérifié par git check-ref-format.
export const BranchName = text('Le nom de branche doit être un texte').check(z.regex(/^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,99}$/, 'Nom invalide : lettres, chiffres, . _ / - sans espace'));
export const BranchBody = z.object({ name: BranchName }, body); // POST …/git/branch
// Événement de hook posté par Claude Code (POST /api/hook) : seuls les champs lus par le daemon sont décrits, le reste est ignoré.
export const HookEvent = z.object({
  session_id: text('session_id manquant'),
  hook_event_name: text('hook_event_name manquant'),
  tool_name: z.optional(str),
  tool_input: z.optional(z.record(str, z.unknown())),
  notification_type: z.optional(str),
  message: z.optional(str),
}, body);
export const RestoreBody = z.object({ path: text('Indique le fichier à restaurer') }, body);
export const FileQuery = z.object({ path: text('Indique le fichier') }, body); // GET …/git/file ou …/files/read (paramètre d'URL)
// GET /api/sessions/:id/files/search?q=…&case=1 (paramètres d'URL). Texte littéral ; insensible à la casse sauf case=1.
export const SearchQuery = z.object({
  q: text('Indique le texte à chercher').check(z.minLength(2, 'Au moins 2 caractères'), z.maxLength(200, '200 caractères au plus')),
  case: z.boolean(),
}, body);
// GET …/log?since=N (paramètre d'URL, absent = 0) : seulement les lignes à partir de cette date (ms).
export const LogQuery = z.object({
  since: z.number({ error: 'since doit être une date en ms' }).check(z.gte(0, 'since doit être une date en ms')),
}, body);
// GET /api/projects?q= (paramètre d'URL, absent = '') : texte tapé dans le sélecteur, chemin ou non.
export const ProjectsQuery = z.object({ q: text('q doit être un texte').check(z.maxLength(4096, 'Chemin trop long')) }, body);
// GET /api/usage?days=N (paramètre d'URL, absent = 14) ; 400 = RETENTION_DAYS du daemon.
export const UsageQuery = z.object({
  days: z.int({ error: 'Nombre de jours invalide' }).check(z.gte(1, 'Entre 1 et 400 jours'), z.lte(400, 'Entre 1 et 400 jours')),
}, body);
// `content` vide autorisé : vider un fichier est légitime.
export const WriteBody = z.object({
  path: text('Indique le fichier'),
  content: text('Le contenu doit être un texte'),
  hash: text('Empreinte manquante').check(z.regex(/^[0-9a-f]{64}$/, 'Empreinte invalide')),
}, body); // POST …/git/write ou …/files/write
export const CommitBody = z.object({ message: text('Le message de commit est vide').check(z.refine((s) => s.trim() !== '', 'Le message de commit est vide')) }, body);
// POST sans paramètre (/api/chat, /api/chat/:id/delete, …/delete, …/git/commit-message, /api/terminals/:id/close) : `{}` seulement.
export const EmptyBody = z.strictObject({}, body);
// POST …/terminals : corps `{}` = un shell, rien d'autre (une UI d'avant les plugins qui envoie `miseTask` prend un 400).
// Les terminaux d'un outil (mise, Xcode…) passent par l'action d'un plugin. Même schéma qu'EmptyBody, nom gardé pour l'UI.
export const TerminalBody = EmptyBody;
// POST /api/plugins/:id
export const PluginToggleBody = z.object({ enabled: z.boolean({ error: 'enabled doit être un booléen' }) }, body);
// POST …/plugins/:pid/call/:method : `params` libre ici, validé ensuite par le schéma de la méthode (dans le plugin).
export const PluginCallBody = z.object({ params: z.optional(z.unknown()) }, body);
// POST …/plugins/:pid/actions/:aid : `params` plats (scalaires), validés ensuite par le schéma de l'action.
// Strict : une UI d'avant la 037 qui envoie `values` prend un 400 clair plutôt qu'une action lancée sans ses choix.
export const PluginActionBody = z.strictObject({
  params: z.optional(z.record(pname, z.union([ptext, num, bool, z.null()], { error: 'Paramètre invalide' }), { error: 'Paramètres invalides' })),
}, body);
// Fichier ~/.vigie/settings.json (lu par le transport) : SettingsBody + état des plugins. Jamais accepté en POST /api/settings.
export const SettingsFile = z.extend(SettingsBody, { plugins: z.optional(z.record(str, bool)) });
export const InputBody = z.object({ data: text('Le texte à envoyer au terminal manque') }, body);
// Entier borné : 2**31 passerait `> 0` puis ferait lever pty.resize dans l'écouteur WebSocket.
const positive = z.int().check(z.positive(), z.lte(10_000));
export const PtyMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: str }),
  z.object({ type: z.literal('resize'), cols: positive, rows: positive }),
]);
