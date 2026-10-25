# Surveillance périodique des balises

Le backend local peut relire les balises statiques pendant que l'API tourne.
La balise reste passive. Cette surveillance vérifie la lecture et la validité du
document de déploiement ; elle ne mesure pas la santé métier de l'application.

## Activation

Dans la configuration serveur de chaque environnement, ajouter à la source
`metadata` existante :

```json
{
  "type": "static",
  "url": "https://example.org/pulsepit-deployment.json",
  "monitoring": { "enabled": true, "interval": "5m" }
}
```

`monitoring` absent signifie désactivé. Lorsqu'il est présent, `enabled` doit être
un booléen et `interval` vaut `5m`, `15m`, `30m` ou `1h`, même si la surveillance
est désactivée. Les champs inconnus sont refusés. Une configuration invalide
utilise l'isolation existante par dépôt au démarrage ; les autres dépôts restent
utilisables. Redémarrer l'API après une modification de la configuration.

Seuls les dépôts accessibles dans les dossiers de scan sont surveillés. Une
configuration de dépôt absent, exclu ou hors périmètre ne lance aucune lecture.
La source et ses paramètres restent privés dans les réponses de configuration.

## Lecture de l'état

`GET /api/monitoring` renvoie HTTP 200 avec :

```json
{
  "environments": [{
    "path": "/projects/example",
    "environment": "production",
    "enabled": true,
    "interval": "5m",
    "status": "up",
    "since": "2026-10-25T12:00:00.000Z",
    "lastCheckedAt": "2026-10-25T12:05:00.000Z",
    "error": null
  }]
}
```

Contrats Zod et types exportés par `@pulsepit/contracts` :
`BeaconMonitoringInterval`, `BeaconMonitoringEnvironment`,
`BeaconMonitoringResponse`. Le contrat `MonitoringResponse` existant du ping
HTTP reste distinct.

La route ne consulte aucune balise : elle lit l'état en mémoire et vérifie
localement que les chemins restent accessibles dans le périmètre de scan.
Les dépôts devenus inaccessibles sont exclus. Seuls les environnements ayant
une source `metadata` apparaissent, y compris lorsque leur surveillance est
désactivée.

| Statut | Signification |
| --- | --- |
| `disabled` | Surveillance désactivée ; intervalle, dates et erreur à `null`. |
| `pending` | Activée, aucun contrôle terminé ; `since` contient l'initialisation, dernière vérification et erreur à `null`. |
| `up` | Document lu et validé ; erreur à `null`. |
| `down` | Une lecture a échoué ; erreur assainie du lecteur. |

Un seul échec suffit à passer `down`, une lecture valide suffit à revenir `up`.
`since` change uniquement lors d'un changement de statut. `lastCheckedAt` et
`error` décrivent le dernier contrôle terminé, même si l'état reste `down` avec
une autre cause. Les dates sont en ISO UTC.

Les erreurs existantes du lecteur sont conservées : `HTTP_ERROR`, `TIMEOUT`,
`NETWORK_ERROR`, `INVALID_RESPONSE`, `UNSUPPORTED_PROTOCOL`,
`ENVIRONMENT_MISMATCH`. Une erreur de document ou d'environnement ne prouve pas
que le site entier est inaccessible. Aucun URL privé, en-tête ou token n'est
ajouté aux erreurs.

## Exécution et limites

Le premier contrôle démarre à l'initialisation de l'API ; la disponibilité HTTP
n'attend pas sa réponse. Le prochain contrôle est programmé après la fin du
précédent, avec l'intervalle configuré. Aucun chevauchement de contrôles
périodiques d'un même environnement, aucun rattrapage ni retry immédiat.

Le lecteur conserve son délai de cinq secondes par lecture active, sa limite
64 Kio, le refus des redirections et l'absence de token. Quatre lectures actives
maximum sont partagées dans le processus entre surveillance et consultations
manuelles ; l'attente d'un créneau précède le délai de lecture.

Aucun ping applicatif ni appel aux fournisseurs de dates n'est effectué par la
surveillance. `GET /api/repositories/deployments` conserve sa lecture à la demande
et son enrichissement habituel ; il ne lit pas ce cache.

À l'arrêt, les temporisations sont supprimées et les lectures périodiques
actives ou en attente sont annulées sans replanification. L'état est perdu au
redémarrage, sans historique, persistance ou notification externe.
