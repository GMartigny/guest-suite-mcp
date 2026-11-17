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

Il vous faut un **token** de l'Experience API (fourni par votre contact technique Guest Suite) et l'**identifiant de votre établissement** (`externalLocationId`). Si vous ne le connaissez pas, configurez d'abord le serveur sans `?location=` et appelez l'outil `list_locations`.

Configuration du client MCP :

- **URL** : `https://<instance>.vercel.app/mcp` (option : `?location=<votre-externalLocationId>` pour l'établissement par défaut)
- **En-tête** : `X-AUTH-TOKEN: <votre-token>` (ou `Authorization: Bearer <votre-token>`)

Le token n'est accepté que dans un en-tête, jamais dans l'URL.

- **claude.ai** : Réglages → Connecteurs → Ajouter un connecteur personnalisé, avec l'URL ci-dessus et l'en-tête `X-AUTH-TOKEN`.
- **Claude Code** :

```sh
claude mcp add --transport http guest-suite https://<instance>.vercel.app/mcp --header "X-AUTH-TOKEN: <votre-token>"
```

`location` est facultatif : sans lui, passez `externalLocationId` à chaque appel de `request_review`.

### Sécurité

- Le token voyage uniquement dans un en-tête HTTPS : il n'apparaît pas dans les URL ni dans les journaux d'accès.
- Ce serveur ne stocke rien et ne journalise pas les tokens. Si vous préférez ne pas faire transiter votre token par une instance tierce, déployez la vôtre (ci-dessous).

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
