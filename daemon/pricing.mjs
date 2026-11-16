// Tarifs API en $ par million de tokens, pour estimer le coût de la consommation (équivalent API, même sur abonnement).
// ponytail: table à la main, relevée en nov. 2026 sur des sources non officielles ; à corriger ici si Anthropic change ses prix.
// Cache : écriture = 1,25 × entrée, lecture = 0,1 × entrée (multiplicateurs standard d'Anthropic).
const PRICES = [
  // [préfixe du modèle, entrée, sortie] — le premier préfixe qui correspond gagne : du plus précis au plus général.
  ['claude-fable', 10, 50],
  ['claude-opus-5-5', 4, 20],
  ['claude-opus', 5, 25],
  ['claude-sonnet', 2, 10],
  ['claude-haiku', 0.1, 0.5],
];

/** Famille affichée : opus, sonnet, haiku, fable, ou le nom brut. */
export function family(model) {
  return model?.match(/claude-([a-z]+)/)?.[1] ?? model ?? 'inconnu';
}

/** Coût estimé d'un appel, en $. 0 si le modèle est inconnu. */
export function costOf(u) {
  const p = PRICES.find(([prefix]) => u.model?.startsWith(prefix));
  if (!p) return 0;
  const [, input, output] = p;
  return (u.input * input + u.output * output + u.cacheCreate * input * 1.25 + u.cacheRead * input * 0.1) / 1e6;
}
