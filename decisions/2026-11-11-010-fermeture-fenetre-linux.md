# 010 — Sous Linux, fermer la fenêtre quitte l'app

- **Statut :** Acceptée (confirmée le 2026-11-12)
- **Date :** 2026-11-11
- **Décidé par :** Toi, sur recommandation de l'architecte

## Contexte
Sous Linux, quand le daemon est embarqué dans l'app, fermer la fenêtre arrête toutes les sessions en cours.

## Décision
Le comportement standard est conservé : sous Linux, fermer la fenêtre quitte l'app. Le README recommande `vigie install` pour que les sessions survivent à la fermeture.

## Raisons
Aucun code à écrire. Garder l'app vivante sans fenêtre, sans icône de dock ni de barre système, la rendrait invisible.

## Alternatives écartées
- Garder l'app en vie comme sur macOS, et rouvrir la fenêtre au lancement suivant.

## Conséquences
Si un daemon est embarqué, ses sessions s'arrêtent avec l'app : le README recommande `vigie install` sous Linux.
