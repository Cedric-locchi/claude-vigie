# 013 — Polices embarquées au lieu de Google Fonts

- **Statut :** Acceptée
- **Date :** 2026-11-11
- **Décidé par :** Toi (« /impeccable optimize » après l'audit)

## Contexte
L'UI chargeait Inter et JetBrains Mono depuis Google Fonts, une requête externe qui contredit le principe « local uniquement ».

## Décision
Les polices viennent de `@fontsource/inter` et `@fontsource/jetbrains-mono`. Le terminal attend que JetBrains Mono soit chargée avant de s'ouvrir.

## Raisons
- Aucune requête ne sort de la machine, et l'app fonctionne hors ligne.
- Les colonnes du terminal ne se décalent plus quand la police arrive après l'ouverture.

## Alternatives écartées
- Garder Google Fonts : contraire au principe « local uniquement ».

## Conséquences
Deux dépendances de plus (les polices) ; le build copie environ 80 fichiers de police dans `ui/dist`.
