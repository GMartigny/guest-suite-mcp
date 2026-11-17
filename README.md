# guest-suite-mcp

Serveur [MCP](https://modelcontextprotocol.io) pour envoyer des demandes d'avis à [Guest Suite](https://www.guest-suite.com) depuis Claude (ou tout client MCP), via l'[Experience API](https://experience.guest-suite.com/docs).

Une seule instance hébergée sur Vercel sert tout le monde : chaque utilisateur fournit **son propre token Guest Suite**, que le serveur utilise pour appeler Guest Suite sans jamais l'enregistrer.

## Outils

| Outil | Rôle |
|---|---|
| `list_locations` | Liste les établissements accessibles avec votre token et leur `externalLocationId`. |
| `request_review` | Crée le contact (ou réutilise l'existant pour le même e-mail / téléphone / établissement), puis lui rattache une expérience, ce qui déclenche la demande d'avis. Deux appels le même jour pour le même contact renvoient l'expérience existante. |
| `update_contact` | Modifie un contact déjà envoyé (prénom, nom, langue, données complémentaires). Seuls les champs passés sont modifiés ; `null` efface un champ. |
| `update_experience` | Modifie les données complémentaires d'une expérience déjà envoyée. |

## Utilisation

Il vous faut un **token** de l'Experience API (fourni par votre contact technique Guest Suite) et l'**identifiant de votre établissement** (`externalLocationId`). Si vous ne le connaissez pas, ajoutez d'abord le connecteur sans `?location=` et demandez à Claude d'appeler `list_locations`.

URL du connecteur :

```
https://<instance>.vercel.app/mcp/<votre-token>?location=<votre-externalLocationId>
```

- **claude.ai** : Réglages → Connecteurs → Ajouter un connecteur personnalisé, collez l'URL ci-dessus.
- **Clients qui acceptent des en-têtes** (Claude Code, Claude Desktop…) : URL `https://<instance>.vercel.app/mcp?location=...` et en-tête `X-AUTH-TOKEN: <token>` (ou `Authorization: Bearer <token>`).

`location` est facultatif : sans lui, passez `externalLocationId` à chaque appel de `request_review`.

### Sécurité

- Traitez l'URL du connecteur comme un mot de passe : elle contient votre token.
- Ce serveur ne stocke rien et ne journalise pas les tokens. Comme pour toute requête HTTP, l'hébergeur peut toutefois conserver les URL appelées dans ses journaux techniques : si c'est un problème, déployez votre propre instance (ci-dessous) ou utilisez l'en-tête.

## Déployer sa propre instance

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GMartigny/guest-suite-mcp)

Aucune variable d'environnement n'est requise. Optionnel : `GUEST_SUITE_API_URL` pour viser une autre URL de l'API (par défaut `https://experience.guest-suite.com`).

## Développement

```sh
npm install
npm test
```

Le point d'entrée Vercel est `api/mcp.js` (transport Streamable HTTP, sans session) ; les outils sont définis dans `lib/mcp-server.js` et le client Guest Suite dans `lib/guest-suite.js`.

## Licence

MIT
