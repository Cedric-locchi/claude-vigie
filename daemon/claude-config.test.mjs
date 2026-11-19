// node --test daemon/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { frontmatter, mask, readClaudeConfig } from './claude-config.mjs';
import { ClaudeConfig } from '../contract/index.mjs';
import { tempDir } from './plugins.mjs'; // dossiers temporaires effacés à la fin du fichier

// Sortie conforme au contrat : parse retire les clés inconnues, donc l'égalité échoue sur un champ manquant comme sur un champ en trop.
const conforme = (S, v) => { const j = JSON.parse(JSON.stringify(v)); assert.deepStrictEqual(S.parse(j), j); };

// CLAUDE_CONFIG_DIR passe devant `home` : sans ça, les tests liraient le vrai profil.
delete process.env.CLAUDE_CONFIG_DIR;

function setup(files) {
  const root = tempDir('vigie-cfg-');
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return { home: path.join(root, 'home'), cwd: path.join(root, 'home', 'proj'), managed: path.join(root, 'managed.json') };
}

test('frontmatter : valeurs simples et blocs', () => {
  assert.deepEqual(frontmatter('---\nname: revue\ndescription: >\n  Relit le diff\n  et signale\n---\ncorps'), { name: 'revue', description: 'Relit le diff et signale' });
  assert.equal(frontmatter('pas d’en-tête'), null);
});

test('masque les secrets mais pas les chemins', () => {
  assert.equal(mask('API_TOKEN=abc123'), 'API_TOKEN=•••');
  assert.ok(!mask('--header Authorization: Bearer sk-ant-123').includes('sk-ant'));
  assert.ok(!mask('curl -H "x-api-key: sk-ant-api03-abc"').includes('sk-ant'));
  assert.equal(mask('node /Users/moi/projets/mon-super-projet-avec-un-nom-long/hook.mjs'), 'node /Users/moi/projets/mon-super-projet-avec-un-nom-long/hook.mjs');
  assert.equal(mask('x a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'), 'x •••');
});

test('lit la config par portée et signale les trous', () => {
  const { home, cwd, managed } = setup({
    'home/.claude/CLAUDE.md': '# Profil',
    'home/.claude/settings.json': { env: { GITHUB_TOKEN: 'ghp_secret' }, permissions: { allow: ['Bash(*)'] }, enabledPlugins: { 'figma@x': true } },
    'home/.claude/skills/revue/SKILL.md': '---\nname: revue\ndescription: Relit le diff\n---\n',
    'home/.claude/agents/explorer.md': '---\nname: explorer\ndescription: Cherche\ntools: Read, Grep\n---\n',
    'home/proj/CLAUDE.md': 'Voir @docs/archi.md et @docs/absent.md\n',
    'home/proj/docs/archi.md': 'archi',
    'home/proj/.claude/settings.json': { hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/fin.sh' }] }] } },
    'home/proj/.claude/settings.local.json': '{ invalide',
    'home/proj/.claude/skills/revue/SKILL.md': '---\nname: revue\n---\n',
    'home/proj/.claude/skills/vide/notes.txt': 'x',
    'home/proj/.claude/agents/sans-entete.md': 'juste du texte',
    'home/proj/.claude/commands/git/pr.md': '---\ndescription: Ouvre une PR\n---\n',
    'home/proj/.mcp.json': { mcpServers: { docs: { url: 'https://mcp.example.com/sse?token=abc' } } },
    'home/.claude.json': { oauthAccount: { emailAddress: 'moi@example.com' }, mcpServers: { local: { command: 'npx', args: ['srv', '--key=s3cr3t'], env: { API_KEY: 'x' } } } },
  });
  const c = readClaudeConfig(cwd, home, managed);
  conforme(ClaudeConfig, c);
  const json = JSON.stringify(c);
  // Aucun secret ni info de compte ne sort.
  for (const secret of ['ghp_secret', 's3cr3t', 'token=abc', 'moi@example.com']) assert.ok(!json.includes(secret), secret);
  assert.deepEqual(c.env, [{ scope: 'utilisateur', name: 'GITHUB_TOKEN' }]);
  assert.deepEqual(c.mcp.map((m) => [m.scope, m.name, m.target]), [['projet', 'docs', 'https://mcp.example.com/sse'], ['utilisateur', 'local', 'npx srv --key=•••']]);

  assert.deepEqual(c.instructions.map((i) => i.scope), ['projet', 'utilisateur']);
  assert.deepEqual(c.instructions[0].imports, [{ ref: 'docs/archi.md', ok: true }, { ref: 'docs/absent.md', ok: false }]);
  assert.deepEqual(c.skills.map((s) => [s.scope, s.name]), [['projet', 'revue'], ['utilisateur', 'revue']]);
  assert.deepEqual(c.commands.map((s) => s.name), ['/git:pr']);
  // Le corps markdown suit, sans l'en-tête.
  assert.equal(c.instructions[1].body, '# Profil');
  assert.equal(c.skills[1].body, '');
  assert.equal(c.agents.find((a) => a.name === 'sans-entete').body, 'juste du texte');
  assert.deepEqual(c.plugins, [{ name: 'figma@x', enabled: true }]);

  const msgs = c.checks.map((k) => `${k.level} ${k.area}: ${k.message}`).join('\n');
  for (const expected of [
    /error Réglages: JSON invalide/, /error Instructions: Import introuvable : @docs\/absent\.md/,
    /error Skills: Dossier de skill sans SKILL.md : « vide »/, /error Skills: « revue » : description manquante/, /error Agents: « sans-entete »/,
    /error Hooks: Stop : le script .*fin\.sh n'existe pas/, /warning Permissions: « Bash\(\*\) »/,
    /warning Permissions: Aucune règle deny sur \.env/, /info Skills: « revue » existe au projet et dans ton profil/,
    /info MCP: Serveur du projet pas encore approuvé : docs/,
  ]) assert.match(msgs, expected);
  // Erreurs d'abord.
  assert.equal(c.checks[0].level, 'error');
});

test('skills/synced du profil : conteneur de lots, pas un skill', () => {
  const { home, cwd, managed } = setup({
    'home/proj/CLAUDE.md': 'x',
    'home/.claude/skills/synced/.bucket-a_b': '',
    'home/.claude/skills/synced/lot1/manifest.json': { skills: [] },
    'home/.claude/skills/synced/lot1/pdf/SKILL.md': '---\nname: pdf\ndescription: Lit les PDF\n---\n',
    'home/.claude/skills/synced/lot1/muet/SKILL.md': '---\nname: muet\n---\n',
    'home/.claude/skills/synced/lot2/pdf/SKILL.md': '---\nname: pdf\ndescription: Lit les PDF\n---\n',
    'home/.claude/skills/synced/lot2/docx/SKILL.md': '---\nname: docx\ndescription: Word\n---\n',
  });
  const c = readClaudeConfig(cwd, home, managed);
  const msgs = c.checks.map((k) => `${k.level} ${k.area}: ${k.message}`).join('\n');
  assert.doesNotMatch(msgs, /synced/);
  assert.deepEqual(c.skills.map((s) => [s.scope, s.name]).sort(), [['utilisateur', 'docx'], ['utilisateur', 'muet'], ['utilisateur', 'pdf']]);
  assert.match(msgs, /error Skills: « muet » : description manquante/);
});

test('doublon dans le profil : dossier classique et skill synchronisé', () => {
  const skill = '---\nname: pdf\ndescription: Lit les PDF\n---\n';
  const { home, cwd, managed } = setup({
    'home/proj/CLAUDE.md': 'x',
    'home/.claude/skills/pdf/SKILL.md': skill,
    'home/.claude/skills/synced/lot1/pdf/SKILL.md': skill,
  });
  const msgs = readClaudeConfig(cwd, home, managed).checks.map((k) => `${k.level} ${k.area}: ${k.message}`).join('\n');
  assert.doesNotMatch(msgs, /existe au projet/);
  assert.match(msgs, /info Skills: « pdf » existe dans ton profil et parmi les skills synchronisés : ~\/\.claude\/skills\/pdf\/SKILL\.md, ~\/\.claude\/skills\/synced\/lot1\/pdf\/SKILL\.md\./);
});

test('remote-settings.json : réglages de l\'organisation, ses deny comptent', () => {
  const files = { 'home/proj/CLAUDE.md': 'x' };
  const without = setup(files);
  assert.match(JSON.stringify(readClaudeConfig(without.cwd, without.home, without.managed).checks), /Aucune règle deny sur \.env/);
  const { home, cwd, managed } = setup({
    ...files,
    'home/.claude/remote-settings.json': { _README: ['doc'], env: { SECRET_X: 'valeur' }, permissions: { deny: ['Read(**/.env)'] } },
  });
  const c = readClaudeConfig(cwd, home, managed);
  assert.doesNotMatch(JSON.stringify(c.checks), /Aucune règle deny sur \.env/);
  assert.deepEqual(c.permissions, [{ scope: 'organisation', kind: 'deny', rule: 'Read(**/.env)' }]);
  assert.deepEqual(c.env, [{ scope: 'organisation', name: 'SECRET_X' }]);
  assert.ok(!JSON.stringify(c).includes('valeur'));
});
