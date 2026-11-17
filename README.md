# guest-suite-mcp

Serveur [MCP](https://modelcontextprotocol.io) pour [Guest Suite](https://www.guest-suite.com), utilisable depuis Claude (ou tout client MCP) :

- envoyer des demandes d'avis, via l'[Experience API](https://experience.guest-suite.com/docs) ;
- lire les avis publiés et la note moyenne, via la [Widget Reviews API](https://widget.guest-suite.com/docs).

Une seule instance hébergée sur Vercel sert tout le monde : chaque utilisateur fournit **ses propres tokens Guest Suite**, que le serveur utilise pour appeler Guest Suite sans jamais les enregistrer.

## Outils

Chaque groupe d'outils n'apparaît que si son token est fourni.

### Demandes d'avis (token Experience API)

| Outil | Rôle |
|---|---|
| `list_locations` | Liste les établissements accessibles avec votre token et leur `externalLocationId`. |
| `request_review` | Crée le contact (ou réutilise l'existant pour le même e-mail / téléphone / établissement), puis lui rattache une expérience, ce qui déclenche la demande d'avis. Deux appels le même jour pour le même contact renvoient l'expérience existante. |
| `update_contact` | Modifie un contact déjà envoyé (prénom, nom, langue, données complémentaires). Seuls les champs passés sont modifiés ; `null` efface un champ. |
| `update_experience` | Modifie les données complémentaires d'une expérience déjà envoyée. |

### Avis publiés (token Widget API)

| Outil | Rôle |
|---|---|
| `list_reviews` | Liste les avis publiés vers votre widget (note sur 10, commentaire, auteur, réponses, données complémentaires envoyées avec la demande). Filtres : établissement, dates, langue, pagination (à partir de 0). |
| `get_review_stats` | Note moyenne et nombre d'avis, pour un établissement ou pour tous ceux du token. |

## Utilisation

Il vous faut au moins l'un des deux tokens :

- **Experience API** (demandes d'avis) : fourni par votre contact technique Guest Suite. Il faut aussi l'**identifiant de votre établissement** (`externalLocationId`) ; si vous ne le connaissez pas, configurez d'abord le serveur sans `?location=` et appelez l'outil `list_locations`.
- **Widget API** (avis publiés) : le token d'organisation vient de votre Account Manager ; les tokens d'établissement se trouvent dans l'interface Guest Suite, onglet API des réglages du widget.

Configuration du client MCP :

- **URL** : `https://<instance>.vercel.app/mcp` (option : `?location=<votre-externalLocationId>` pour l'établissement par défaut)
- **En-têtes** :
  - `X-AUTH-TOKEN: <token-experience>` (ou `Authorization: Bearer <token-experience>`)
  - `X-WIDGET-TOKEN: <token-widget>`

Les tokens ne sont acceptés que dans des en-têtes, jamais dans l'URL.

- **claude.ai** : Réglages → Connecteurs → Ajouter un connecteur personnalisé, avec l'URL ci-dessus et le ou les en-têtes.
- **Claude Code** :

```sh
claude mcp add --transport http guest-suite https://<instance>.vercel.app/mcp --header "X-AUTH-TOKEN: <token-experience>" --header "X-WIDGET-TOKEN: <token-widget>"
```

`location` est facultatif : sans lui, passez `externalLocationId` à chaque appel de `request_review`.

### Sécurité

- Les tokens voyagent uniquement dans des en-têtes HTTPS : ils n'apparaissent pas dans les URL ni dans les journaux d'accès de ce serveur.
- La Widget API n'accepte son token qu'en paramètre d'URL : c'est le serveur qui l'y ajoute, uniquement pour l'appel à Guest Suite.
- Ce serveur ne stocke rien et ne journalise pas les tokens. Si vous préférez ne pas faire transiter votre token par une instance tierce, déployez la vôtre (ci-dessous).

## Déployer sa propre instance

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GMartigny/guest-suite-mcp)

Aucune variable d'environnement n'est requise. Optionnel : `GUEST_SUITE_API_URL` et `GUEST_SUITE_WIDGET_API_URL` pour viser d'autres URL des API (par défaut `https://experience.guest-suite.com` et `https://widget.guest-suite.com`).

## Développement

```sh
npm install
npm test
```

Le point d'entrée Vercel est `api/mcp.js` (transport Streamable HTTP, sans session) ; les outils sont définis dans `lib/mcp-server.js` et les clients Guest Suite dans `lib/guest-suite.js` (Experience API) et `lib/widget.js` (Widget API).

## Licence

MIT
