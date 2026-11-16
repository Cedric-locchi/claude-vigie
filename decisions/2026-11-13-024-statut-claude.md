# 024 — Statut de Claude (status.claude.com) : seule requête sortante

- **Statut :** Acceptée
- **Date :** 2026-11-13
- **Décidé par :** Toi (« interroger status.claude.com pour avoir les infos de panne dans la nav »)

## Contexte
Quand Claude est en panne, les sessions restent bloquées sans raison visible dans Vigie. Pour savoir si l'incident vient d'Anthropic, il faut aller voir status.claude.com. Or la règle « local uniquement » interdit toute requête vers l'extérieur.

## Décision
Exception unique à la règle « local uniquement » : le daemon, et lui seul, fait un `GET https://status.claude.com/api/v2/summary.json` (API Statuspage publique) au démarrage puis toutes les 5 minutes environ. Il n'envoie rien : pas de corps, pas de cookie, pas d'identifiant. Le résultat est normalisé puis poussé dans le snapshot WebSocket. L'UI ne fait aucune requête externe ; elle affiche dans la nav une pastille d'état et le nom de l'incident en cours.

## Raisons
- Distinguer une panne d'Anthropic d'un problème local sans quitter l'app.
- Passer par le daemon garde la CSP et l'UI 100 % locales, et un seul appel sert tous les clients.
- Une API publique en lecture seule, interrogée sans aucune donnée envoyée, ne fait rien fuiter de la machine, hormis l'adresse IP.

## Alternatives écartées
- Simple lien vers status.claude.com : aucune info de panne affichée dans l'app.
- Requête directe depuis l'UI : il faudrait ouvrir la CSP, et chaque fenêtre ferait son propre appel.
- Appel désactivé par défaut et activable dans les réglages : réglage de plus pour un gain faible ; on l'ajoutera si quelqu'un le demande.

## Conséquences
- Hors ligne, ou si le domaine est bloqué, le statut reste inconnu ; rien d'autre n'est touché.
- Toute autre requête sortante demande une nouvelle décision.
