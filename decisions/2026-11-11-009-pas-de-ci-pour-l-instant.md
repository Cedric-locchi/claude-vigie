# 009 — Pas de CI pour l'instant

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi (« la CI pour le moment on s'en fout »)

## Contexte
`node-pty` doit être compilé sur chaque OS, et une seule machine macOS est disponible.

## Décision
Pas de CI. Le portage est vérifié par des tests unitaires qui simulent chaque plateforme. Les paquets Linux et l'usage sous WSL se testent à la main, sur une vraie machine, avec une checklist.

## Raisons
Priorité au code. La CI viendra quand les paquets Linux devront sortir régulièrement.

## Alternatives écartées
- GitHub Actions avec macOS et Linux : remis à plus tard.

## Conséquences
- Aucun paquet Linux n'est produit ni testé automatiquement.
- La checklist manuelle (Linux natif et WSL) reste à faire.
