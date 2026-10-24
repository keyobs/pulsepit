# Diagnostic des dépendances et erreurs des registres

`POST /api/repositories/outdated` conserve sa requête `{ path }` et son succès
`OutdatedResponse` pour npm, pnpm, Yarn Classic et Yarn Modern.

Les échecs de registre identifiés donnent HTTP **502** avec
`{ path, code, error }`. Il s'agit d'un échec pour joindre ou interroger un
service amont, pas d'un échec d'authentification à l'API Pulsepit.
`ErrorResponse` reste compatible ; `RegistryDiagnosticCode` est exporté comme
schéma et type par `@pulsepit/contracts`.

| Code | Interprétation et action |
| --- | --- |
| `REGISTRY_CREDENTIALS_MISSING` | Le gestionnaire signale une authentification non configurée ou une variable de token reconnue non définie. Configurer les identifiants dans l'environnement de l'API ou les fichiers du gestionnaire. |
| `REGISTRY_AUTHENTICATION_FAILED` | Le registre refuse l'authentification. Vérifier la configuration des identifiants et leur validité. |
| `REGISTRY_ACCESS_DENIED` | L'accès est interdit. Vérifier les identifiants, leurs permissions et l'accès au package. |
| `REGISTRY_DNS_FAILED` | Un nom utilisé pour joindre le registre ou le proxy ne peut pas être résolu. Vérifier DNS, réseau, VPN et proxy. |
| `REGISTRY_CONNECTION_FAILED` | Connexion refusée, interrompue ou réseau inaccessible. Vérifier réseau, VPN, pare-feu et proxy. |
| `REGISTRY_TLS_FAILED` | Vérification du certificat impossible. Vérifier la chaîne de confiance, les certificats, l'horloge et le proxy. |
| `REGISTRY_REQUEST_TIMEOUT` | Une requête du gestionnaire au registre a expiré. Vérifier la connectivité puis réessayer plus tard. |
| `REGISTRY_UNAVAILABLE` | Une requête retourne HTTP 5xx ; le registre ou un intermédiaire peut être indisponible. Réessayer plus tard. |

Les messages d'identifiants manquants ou d'authentification refusée rappellent
de redémarrer l'API si son `.env` a changé. Le frontend
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

La classification réseau reconnaît les codes système connus (résolution DNS,
connexion, délai et certificat), les codes npm `E5xx` et pnpm
`ERR_PNPM_FETCH_5xx`, ainsi que les détails d'erreur réseau de Yarn. Les erreurs
pnpm de métadonnées ne sont précisées que si leur cause contient une signature
reconnue. Une erreur Yarn `YN0035` seule ne suffit pas à déterminer une cause.
Aucune stratégie de retry supplémentaire ni modification des certificats ou du
proxy n'est appliquée.

Aucun état d'authentification n'est déduit de la seule absence de variables :
un registre public ou des identifiants configurés dans les fichiers du gestionnaire
peuvent fonctionner normalement. Une erreur 404 ou 500 ne devient pas un refus
d'authentification. Un code HTTP 5xx reconnu relève désormais de
`REGISTRY_UNAVAILABLE`. Sans signature fiable, les erreurs existantes
`COMMAND_FAILED`/`INVALID_OUTPUT` restent utilisées. Le délai global de trente
secondes garde `TIMEOUT` et HTTP 504 ; `REGISTRY_REQUEST_TIMEOUT` décrit une
expiration signalée par le gestionnaire et reste en HTTP 502.

Les messages publics sont des textes fixes. Ils n'incluent ni sortie brute,
URL de registre, nom de compte, chemin de configuration privé, en-tête, token
ou valeur de variable. Les flux servent uniquement à la classification en mémoire,
sans ajout de logs. Le filtrage de l'environnement enfant, les commandes, les
scripts désactivés et les bornes de délai et de sortie restent inchangés.
