# Diagnostic des dépendances et authentification aux registres

`POST /api/repositories/outdated` conserve sa requête `{ path }` et son succès
`OutdatedResponse` pour npm, pnpm, Yarn Classic et Yarn Modern.

Les échecs de registre identifiés donnent HTTP **502** avec
`{ path, code, error }`. Il s'agit du refus du gestionnaire de packages par un
service amont, pas d'un échec d'authentification à l'API Pulsepit.
`ErrorResponse` reste compatible ; `RegistryDiagnosticCode` est exporté comme
schéma et type par `@pulsepit/contracts`.

| Code | Interprétation et action |
| --- | --- |
| `REGISTRY_CREDENTIALS_MISSING` | Le gestionnaire signale une authentification non configurée ou une variable de token reconnue non définie. Configurer les identifiants dans l'environnement de l'API ou les fichiers du gestionnaire. |
| `REGISTRY_AUTHENTICATION_FAILED` | Le registre refuse l'authentification. Vérifier la configuration des identifiants et leur validité. |
| `REGISTRY_ACCESS_DENIED` | L'accès est interdit. Vérifier les identifiants, leurs permissions et l'accès au package. |

Les messages rappellent de redémarrer l'API si son `.env` a changé. Le frontend
peut traduire ces codes ; à défaut, son mécanisme actuel affiche le message
assaini du serveur. Il ne doit pas demander de coller un token dans le panneau
de diagnostic. Les requêtes de diagnostic ne modifient pas les identifiants.

La reconnaissance utilise des signatures bornées aux erreurs : codes npm
`E401`/`EOTP`, `E403`, `ENEEDAUTH`, codes pnpm `ERR_PNPM_FETCH_401/403`, événements
Yarn `YN0033`/`YN0041`, détails `Response Code: 401/403` d'erreurs réseau `YN0035`,
et erreurs Classic de requête 401/403. Les substitutions de variables Yarn
manquantes sont reconnues pour `NPM_TOKEN`, `NODE_AUTH_TOKEN` et
`YARN_NPM_AUTH_TOKEN`. Les flux JSON structurés sont examinés, ainsi que les
lignes d'erreur connues lorsque la commande échoue ; les avertissements et les
mentions de codes dans les données d'un rapport ne suffisent pas.

Aucun état d'authentification n'est déduit de la seule absence de variables :
un registre public ou des identifiants configurés dans les fichiers du gestionnaire
peuvent fonctionner normalement. Une erreur 404 ou 500 ne devient pas un refus
d'authentification. Sans signature fiable, les erreurs existantes
`COMMAND_FAILED`/`INVALID_OUTPUT` restent utilisées ; les délais restent `TIMEOUT`.

Les messages publics sont des textes fixes. Ils n'incluent ni sortie brute,
URL de registre, nom de compte, chemin de configuration privé, en-tête, token
ou valeur de variable. Les flux servent uniquement à la classification en mémoire,
sans ajout de logs. Le filtrage de l'environnement enfant, les commandes, les
scripts désactivés et les bornes de délai et de sortie restent inchangés.
