// Configuration Claude Code qui s'applique à un dossier : instructions, skills, agents, commandes, hooks,
// permissions, MCP, plugins — par portée (projet, local, utilisateur, organisation) — plus des vérifications.
// Lecture seule. Aucun secret ne sort : env → noms seulement, chaînes ressemblant à des tokens masquées,
// .claude.json (paths.claudeJsonFile) → uniquement les serveurs MCP. Jamais de .env, de clés ni de credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeConfigDir, claudeJsonFile, expandHome, tildePath } from './paths.mjs';

const REMOTE = 'remote-settings.json'; // réglages gérés côté serveur, synchronisés par Claude Code dans le dossier utilisateur
const CLAUDE_MD_MAX_LINES = 400;
const SKILL_DESCRIPTION_MAX = 1024;
const MODELS = new Set(['inherit', 'opus', 'sonnet', 'haiku', 'fable']);

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

/** Masque ce qui ressemble à un secret : `token=…`, `Bearer …`, longues chaînes aléatoires. */
export function mask(s) {
  return String(s)
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 •••')
    .replace(/((?:token|key|secret|password|passwd|pwd|auth|bearer)[\w-]*["']?\s*[:= ]\s*["']?)[^\s"',]+/gi, '$1•••')
    .replace(/\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{32,}\b/g, '•••'); // longue chaîne lettres+chiffres (token, clé)
}
/** URL sans paramètres ni identifiants (les tokens y passent souvent). */
const cleanUrl = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host}${x.pathname}`; } catch { return mask(u); } };

/** Corps markdown sans l'en-tête : affiché dans l'onglet Config (l'en-tête y est déjà en description / méta). */
export const body = (text) => (text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** Frontmatter YAML minimal : `clé: valeur`, et les blocs `|` / `>` indentés. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '');
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith('|') ? '\n' : ' ');
    }
    out[kv[1]] = value.replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * `managedFile` : réglages gérés de l'organisation (`platform.managedSettingsFile`, passé par le transport ; null = aucun) ;
 * `procEnv` : lu pour CLAUDE_CONFIG_DIR (dossier utilisateur de Claude Code, cf. paths.claudeConfigDir).
 */
export function readClaudeConfig(cwd, home = os.homedir(), managedFile = null, remoteFile = null, procEnv = process.env) {
  const userDir = claudeConfigDir({ env: procEnv, home });
  const tilde = (p) => tildePath(p, home);
  const checks = [];
  const check = (level, area, message, file) => checks.push({ level, area, message, ...(file ? { path: tilde(file) } : {}) });

  // ── Réglages (settings*.json) ──
  const settingsFiles = [
    { scope: 'organisation', file: managedFile },
    { scope: 'organisation', file: remoteFile ?? path.join(userDir, REMOTE) },
    { scope: 'utilisateur', file: path.join(userDir, 'settings.json') },
    { scope: 'projet', file: path.join(cwd, '.claude', 'settings.json') },
    { scope: 'local', file: path.join(cwd, '.claude', 'settings.local.json') },
  ];
  const settings = [];
  for (const { scope, file } of settingsFiles) {
    if (!file) continue;
    const raw = read(file);
    if (raw == null) continue;
    try {
      settings.push({ scope, file, data: JSON.parse(raw) });
    } catch (e) {
      check('error', 'Réglages', `JSON invalide : ${e.message}`, file);
    }
  }

  // ── Instructions (CLAUDE.md du dossier et de ses parents, puis du profil) ──
  const instructions = [];
  const addInstructions = (scope, file) => {
    const text = read(file);
    if (text == null) return;
    const lines = text.split('\n').length;
    const imports = [...text.matchAll(/(?:^|\s)@((?:~|\.{1,2})?\/?[\w./-]+\.\w+)/gm)].map(([, ref]) => {
      // `@~/x` sous le home (expandHome : `~autre/x` reste relatif au fichier, comme tout chemin sans `/` en tête).
      const target = path.resolve(path.dirname(file), expandHome(ref, home));
      const ok = fs.existsSync(target);
      if (!ok) check('error', 'Instructions', `Import introuvable : @${ref}`, file);
      return { ref, ok };
    });
    if (lines > CLAUDE_MD_MAX_LINES) check('warning', 'Instructions', `${lines} lignes : chargé à chaque session, ça consomme du contexte. Déplace le détail dans des skills ou des fichiers importés à la demande.`, file);
    instructions.push({ scope, path: tilde(file), lines, bytes: Buffer.byteLength(text), imports, body: text });
  };
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    addInstructions(dir === cwd ? 'projet' : 'parent', path.join(dir, 'CLAUDE.md'));
    addInstructions(dir === cwd ? 'local' : 'parent', path.join(dir, 'CLAUDE.local.md'));
    if (dir === home || dir === path.dirname(dir)) break;
  }
  addInstructions('utilisateur', path.join(userDir, 'CLAUDE.md'));
  if (!instructions.some((i) => i.scope === 'projet')) check('warning', 'Instructions', 'Pas de CLAUDE.md dans le projet : Claude ne connaît ni ses conventions ni ses commandes (build, tests…). `/init` en génère un.');

  // ── Skills, agents, commandes ──
  const scopes = [{ scope: 'projet', dir: path.join(cwd, '.claude') }, { scope: 'utilisateur', dir: userDir }];

  const skills = [];
  const synced = new WeakSet(); // skills venus de skills/synced (pas de champ JSON : le contrat ne bouge pas)
  const addSkill = (scope, name, skillDir) => {
    const file = path.join(skillDir, 'SKILL.md');
    const text = read(file);
    if (text == null) { check('error', 'Skills', `Dossier de skill sans SKILL.md : « ${name} » est ignoré.`, skillDir); return; }
    const fm = frontmatter(text);
    if (!fm) check('error', 'Skills', `« ${name} » : pas d'en-tête (frontmatter name/description).`, file);
    else {
      if (!fm.description) check('error', 'Skills', `« ${name} » : description manquante, Claude ne saura pas quand l'utiliser.`, file);
      else if (fm.description.length > SKILL_DESCRIPTION_MAX) check('warning', 'Skills', `« ${name} » : description de ${fm.description.length} caractères (max ${SKILL_DESCRIPTION_MAX}).`, file);
      if (fm.name && fm.name !== name) check('warning', 'Skills', `« ${name} » : le nom de l'en-tête (« ${fm.name} ») diffère du dossier.`, file);
    }
    const skill = { scope, name: fm?.name || name, description: fm?.description ?? '', path: tilde(file), body: body(text) };
    skills.push(skill);
    return skill;
  };
  for (const { scope, dir } of scopes) {
    for (const name of list(path.join(dir, 'skills'))) {
      const skillDir = path.join(dir, 'skills', name);
      if (!isDir(skillDir)) continue;
      // skills/synced du profil : conteneur où Claude Code synchronise les skills de claude.ai
      // (synced/<lot>/<skill>/SKILL.md, plus manifest.json et des .bucket-* ignorés car ce ne sont pas des dossiers).
      if (scope === 'utilisateur' && name === 'synced') {
        const seen = new Set();
        for (const lot of list(skillDir)) {
          for (const skill of list(path.join(skillDir, lot))) {
            const d = path.join(skillDir, lot, skill);
            // Le même skill peut figurer dans plusieurs lots : on garde le premier.
            if (seen.has(skill) || !isDir(d)) continue;
            seen.add(skill);
            const added = addSkill(scope, skill, d);
            if (added) synced.add(added);
          }
        }
        continue;
      }
      addSkill(scope, name, skillDir);
    }
  }

  const agents = [];
  for (const { scope, dir } of scopes) {
    for (const f of list(path.join(dir, 'agents')).filter((f) => f.endsWith('.md'))) {
      const file = path.join(dir, 'agents', f);
      const text = read(file);
      const fm = frontmatter(text);
      const name = fm?.name || f.replace(/\.md$/, '');
      if (!fm) check('error', 'Agents', `« ${name} » : pas d'en-tête (frontmatter), l'agent est ignoré.`, file);
      else {
        if (!fm.name) check('error', 'Agents', `« ${name} » : champ name manquant.`, file);
        if (!fm.description) check('error', 'Agents', `« ${name} » : description manquante, Claude ne saura pas quand le déléguer.`, file);
        if (fm.model && !MODELS.has(fm.model) && !fm.model.startsWith('claude-')) check('warning', 'Agents', `« ${name} » : modèle inconnu « ${fm.model} ».`, file);
        if (!fm.tools) check('info', 'Agents', `« ${name} » : pas de liste d'outils, il hérite de tous les outils (y compris l'écriture et Bash).`, file);
      }
      agents.push({ scope, name, description: fm?.description ?? '', tools: fm?.tools ?? null, model: fm?.model ?? null, path: tilde(file), body: body(text) });
    }
  }

  const commands = [];
  for (const { scope, dir } of scopes) {
    const walk = (sub) => {
      for (const f of list(path.join(dir, 'commands', sub))) {
        const rel = path.join(sub, f);
        if (isDir(path.join(dir, 'commands', rel))) { walk(rel); continue; }
        if (!f.endsWith('.md')) continue;
        const file = path.join(dir, 'commands', rel);
        const text = read(file);
        const fm = frontmatter(text);
        commands.push({ scope, name: '/' + rel.replace(/\.md$/, '').split(path.sep).join(':'), description: fm?.description ?? '', path: tilde(file), body: body(text) });
      }
    };
    walk('');
  }

  // Même nom au projet et dans le profil : c'est le projet qui gagne.
  for (const [area, items] of [['Skills', skills], ['Agents', agents], ['Commandes', commands]]) {
    const byName = Map.groupBy(items, (i) => i.name);
    for (const [name, group] of byName) {
      if (new Set(group.map((i) => i.scope)).size > 1) check('info', area, `« ${name} » existe au projet et dans ton profil : la version du projet l'emporte.`);
      // Doublon interne au profil (skills/<x> et skills/synced/<lot>/<x>) : on ne sait pas lequel Claude Code
      // retient, on reste factuel.
      const profile = group.filter((i) => i.scope === 'utilisateur');
      if (profile.some((i) => synced.has(i)) && profile.some((i) => !synced.has(i))) {
        check('info', area, `« ${name} » existe dans ton profil et parmi les skills synchronisés : ${profile.map((i) => i.path).join(', ')}.`);
      }
    }
  }

  // ── Hooks ──
  const hooks = [];
  for (const { scope, file, data } of settings) {
    for (const [event, entries] of Object.entries(data.hooks ?? {})) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        for (const h of entry.hooks ?? []) {
          const command = String(h.command ?? '');
          hooks.push({ scope, event, matcher: entry.matcher ?? null, command: mask(command) });
          // Script référencé par un chemin : doit exister.
          const script = command.match(/(?:^|\s)["']?((?:\$CLAUDE_PROJECT_DIR|\$\{CLAUDE_PROJECT_DIR\}|~|\/)[^\s"']+\.(?:sh|py|js|mjs|cjs|ts|rb))/)?.[1];
          if (script) {
            const resolved = expandHome(script.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, cwd), home);
            if (!fs.existsSync(resolved)) check('error', 'Hooks', `${event} : le script ${tilde(resolved)} n'existe pas, le hook échouera.`, file);
          }
        }
      }
    }
  }

  // ── Permissions ──
  const permissions = [];
  for (const { scope, file, data } of settings) {
    const p = data.permissions ?? {};
    for (const kind of ['allow', 'ask', 'deny']) for (const rule of p[kind] ?? []) permissions.push({ scope, kind, rule: mask(rule) });
    if (p.defaultMode) permissions.push({ scope, kind: 'mode', rule: p.defaultMode });
    if (p.defaultMode === 'bypassPermissions') check('warning', 'Permissions', 'Mode par défaut « bypassPermissions » : Claude exécute tout sans demander.', file);
    for (const rule of p.allow ?? []) {
      if (/^Bash(\((\*|:\*|\*:\*)?\))?$/.test(rule)) check('warning', 'Permissions', `« ${rule} » autorise n'importe quelle commande shell sans confirmation.`, file);
      if (/^(Write|Edit)(\(\*\*?\))?$/.test(rule)) check('info', 'Permissions', `« ${rule} » autorise l'écriture partout sans confirmation.`, file);
    }
  }
  const denies = permissions.filter((p) => p.kind === 'deny').map((p) => p.rule).join(' ');
  if (!/\.env/.test(denies)) check('warning', 'Permissions', "Aucune règle deny sur .env : rien n'empêche Claude de lire tes secrets (ex. deny « Read(./.env*) »).");

  // ── Serveurs MCP ──
  const mcp = [];
  const addServers = (scope, servers, file) => {
    for (const [name, s] of Object.entries(servers ?? {})) {
      mcp.push({
        scope, name,
        type: s.type ?? (s.url ? 'http' : 'stdio'),
        target: s.url ? cleanUrl(s.url) : mask([s.command, ...(s.args ?? [])].filter(Boolean).join(' ')),
        env: Object.keys(s.env ?? {}),
        ...(file ? { path: tilde(file) } : {}),
      });
    }
  };
  const mcpFile = path.join(cwd, '.mcp.json');
  const mcpRaw = read(mcpFile);
  if (mcpRaw != null) {
    try { addServers('projet', JSON.parse(mcpRaw).mcpServers, mcpFile); } catch (e) { check('error', 'MCP', `JSON invalide : ${e.message}`, mcpFile); }
  }
  // ~/.claude.json (dans CLAUDE_CONFIG_DIR s'il est défini) : on n'en extrait QUE les serveurs MCP (le reste contient des infos de compte).
  try {
    const user = JSON.parse(read(claudeJsonFile({ env: procEnv, home })) ?? '{}');
    addServers('utilisateur', user.mcpServers);
    addServers('local', user.projects?.[cwd]?.mcpServers);
  } catch { /* fichier absent ou illisible */ }
  const merged = Object.assign({}, ...settings.map((s) => s.data));
  const projectServers = mcp.filter((m) => m.scope === 'projet');
  if (projectServers.length && !merged.enableAllProjectMcpServers) {
    const enabled = new Set(merged.enabledMcpjsonServers ?? []);
    const off = projectServers.filter((m) => !enabled.has(m.name)).map((m) => m.name);
    if (off.length) check('info', 'MCP', `Serveur${off.length > 1 ? 's' : ''} du projet pas encore approuvé${off.length > 1 ? 's' : ''} : ${off.join(', ')} (Claude demandera au lancement).`, mcpFile);
  }

  // ── Plugins et environnement ──
  const plugins = Object.entries(merged.enabledPlugins ?? {}).map(([name, enabled]) => ({ name, enabled: !!enabled }));
  const env = settings.flatMap(({ scope, data }) => Object.keys(data.env ?? {}).map((name) => ({ scope, name })));

  const order = { error: 0, warning: 1, info: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return {
    cwd: tilde(cwd),
    settings: settings.map(({ scope, file }) => ({ scope, path: tilde(file) })),
    instructions, skills, agents, commands, hooks, permissions, mcp, plugins, env,
    model: merged.model ?? null,
    checks,
  };
}
