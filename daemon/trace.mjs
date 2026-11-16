// Trace d'une session, pure : découpée en tours (un tour = un message de l'humain et tout ce qui suit).
// Étapes = appels d'outils de l'agent principal ; un appel qui lance un sous-agent porte les étapes de celui-ci.
import path from 'node:path';
import { deriveState } from './ingest.mjs';

/**
 * `main` : piste principale ; `subs` : `[{ track, meta }]` ; `summary` : résumé de la session (état, raison, outil) ;
 * `now` : horloge. Mêmes champs que le contrat `SessionTrace`.
 */
export function buildTrace({ main, subs, summary, now }) {
  const alive = summary.state !== 'done';
  // Outil sans résultat : en cours si la session vit, sinon interrompu (on l'arrête à la dernière activité).
  const step = (x) => ({
    id: x.id, name: x.name, kind: x.kind, label: x.label, ...(x.path && { path: x.path }), start: x.start,
    end: x.end || (alive ? null : Math.max(x.start, summary.lastTs)), error: x.error, interrupted: !x.end && !alive,
  });

  // Sous-agents rattachés à l'appel (Task/Agent) qui les a lancés.
  const subByTool = new Map();
  for (const { track, meta } of subs) {
    if (!meta.toolUseId) continue;
    subByTool.set(meta.toolUseId, {
      id: path.basename(track.file, '.jsonl'), name: meta.agentType ?? 'sous-agent', description: meta.description ?? '',
      state: meta.finished ? 'done' : deriveState(track, now).state,
      steps: [...track.tools.values()].map(step),
    });
  }
  const steps = [...main.tools.values()].map((x) => ({ ...step(x), agent: subByTool.get(x.id) ?? null }));

  const starts = main.prompts.length ? main.prompts : [{ ts: main.firstTs, text: main.firstPrompt ?? '' }];
  const turns = starts.map((p, i) => {
    const next = starts[i + 1]?.ts ?? Infinity;
    // Les étapes d'avant le premier message (session reprise…) vont au premier tour.
    const own = steps.filter((x) => (i === 0 || x.start >= p.ts) && x.start < next);
    // Fin du tour = dernière activité (outil ou réponse de Claude), pas le message suivant : le temps où Claude t'attend n'en fait pas partie.
    const replies = [...main.usage.values()].map((u) => u.ts).filter((ts) => ts >= p.ts && ts < next);
    const ends = own.flatMap((x) => [x.end ?? now, ...(x.agent?.steps.map((y) => y.end ?? now) ?? [])]);
    const last = i === starts.length - 1;
    const end = last && alive ? Math.max(now, ...ends) : Math.max(p.ts, ...ends, ...replies);
    return { index: i + 1, start: Math.min(p.ts, ...own.map((x) => x.start)), end, prompt: p.text, live: last && alive, steps: own };
  });

  return {
    now,
    state: summary.state,
    waiting: summary.state === 'waiting' ? { reason: summary.reason ?? 'permission', detail: summary.detail ?? summary.tool ?? '' } : null,
    turns,
  };
}
