# 012 — Exception unique : les discussions sont effacées de `~/.claude`

- **Statut :** Acceptée par défaut (documentée, sans objection de ta part)
- **Date :** 2026-11-11
- **Décidé par :** Proposition de Claude pendant le correctif P2, sans objection

## Contexte
La règle dit que Vigie n'écrit jamais dans `~/.claude`. Pourtant, les discussions temporaires (`cwd` = `~/.vigie/chat`) y étaient purgées sans que ce soit écrit nulle part.

## Décision
Le comportement est conservé et documenté comme seule exception. La garde est renforcée : `isChat` exige que tous les transcripts portant un même identifiant se trouvent dans le dossier des discussions.

## Raisons
Les discussions sont jetables par nature. La garde empêche d'effacer une vraie session, et un test couvre le cas d'un même identifiant présent dans deux projets.

## Alternatives écartées
- N'effacer que les discussions dont Vigie a noté l'identifiant : plus de code pour un cas déjà couvert par la garde.

## Conséquences
L'exception figure dans `CLAUDE.md` et `ARCHITECTURE.md`.
