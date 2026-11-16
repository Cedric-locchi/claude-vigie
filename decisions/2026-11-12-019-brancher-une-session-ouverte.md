# 019 — Changer de branche ou passer en worktree depuis une session ouverte

- **Statut :** Acceptée
- **Date :** 2026-11-12
- **Décidé par :** Toi (sur recommandation)

## Contexte
On se trompe parfois à la création d'une session : pas de branche dédiée, ou pas de worktree. Il faut pouvoir corriger sans repartir de zéro.

## Décision
- **Nouvelle branche** : le daemon lance `git switch -c <nom>` dans le dépôt de la session (route `POST /api/sessions/:id/git/branch`). Les modifs non commitées suivent sur la nouvelle branche.
- **Worktree** : l'UI tape dans le terminal claude une demande d'utiliser l'outil natif `EnterWorktree`. La conversation continue, seul le dossier de travail change. Bloqué pendant une demande d'autorisation ou une question, comme `/compact`.

## Raisons
- Un process `claude` ne peut pas changer de dossier depuis l'extérieur. `EnterWorktree` le fait de l'intérieur, sans relancer la session.
- `git switch -c` emporte les modifs : c'est ce qu'on veut quand on a oublié de créer la branche.

## Alternatives écartées
- Relancer la session dans un worktree créé par le daemon (`git worktree add`, stash, `claude --resume`) : plus lourd, et rien ne garantit que `--resume` retrouve le transcript depuis un autre dossier.
- Refuser la nouvelle branche quand le dossier a des modifs : bloque justement le cas d'usage.

## Limites
- Les modifs non commitées ne suivent pas dans le worktree : elles restent dans le dossier d'origine.
- La demande de worktree passe par Claude : il peut la mettre en file d'attente s'il travaille encore.
