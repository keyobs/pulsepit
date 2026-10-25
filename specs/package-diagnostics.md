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
| `REGISTRY_RATE_LIMITED` | Le registre ou un intermédiaire limite les requêtes (HTTP 429). Attendre avant de relancer ; utiliser `resetAt` lorsqu’il est disponible. |

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

## Limitation de débit et délai de reprise

Les codes npm `E429`, pnpm `ERR_PNPM_FETCH_429` et les erreurs de requête Yarn
signalant HTTP 429 produisent `REGISTRY_RATE_LIMITED`, toujours en HTTP 502.
L'API signale ainsi un échec amont ; elle n'annonce pas sa propre limite de débit.

Le champ optionnel existant `ErrorResponse.resetAt` est une date ISO UTC, ajoutée
uniquement si l'objet d'erreur structuré qui signale le 429 contient un objet
`headers` avec un seul champ `Retry-After` (nom insensible à la casse). Le lecteur
accepte une chaîne contenant un entier décimal non négatif en secondes ou une
date HTTP canonique IMF-fixdate. Les secondes sont ajoutées à l'heure de lecture
du diagnostic ; une date HTTP est conservée comme échéance absolue. Le zéro est
accepté. Les dates passées, valeurs invalides, tableaux, champs ambigus, sauts de
ligne et dates non représentables en ISO à quatre chiffres sont ignorés.

Les en-têtes bruts ne sont jamais renvoyés. Une simple ligne `Retry-After` dans
un log n'est pas associée arbitrairement à une erreur ; aucun délai n'est lu dans
une autre erreur ou inventé depuis le seul code 429. Les sorties courantes des
gestionnaires ne publient souvent pas les en-têtes : dans ce cas `resetAt` est
absent, même si le 429 est reconnu. Aucun appel réseau supplémentaire n'est fait
pour tenter de récupérer cette information.

Le frontend peut afficher l'heure de reprise si elle est connue et une invitation
à patienter sinon. Il ne doit pas interpréter cette heure comme la garantie
qu'une requête suivante réussira. Les politiques de retry internes des gestionnaires
et la limite globale de trente secondes restent inchangées.

## Protection des relances manuelles

Après un `REGISTRY_RATE_LIMITED` avec un `resetAt` fiable encore futur, l'API
conserve en mémoire l'erreur assainie pour ce chemin de dépôt normalisé. Une
nouvelle requête retourne immédiatement la même erreur HTTP **502**, avec le même
`resetAt`, sans exécuter le gestionnaire ni repousser l'échéance. La validation du
dépôt reste préalable : un dépôt supprimé ou hors configuration reçoit HTTP 404.
Changer le gestionnaire ou sa configuration ne supprime pas cette attente.

Dès que l'heure atteint l'échéance, un nouvel appel manuel peut exécuter le
diagnostic. Aucun lancement automatique, minuterie, délai par défaut ou appel
supplémentaire n'est ajouté. Sans échéance future fiable, les appels suivants
restent permis. Les autres erreurs et les succès ne sont pas conservés.

Les appels simultanés pour un même dépôt partagent l'exécution active et son
résultat, y compris lorsqu'aucune échéance n'est connue. Les autres dépôts restent
indépendants : aucun quota commun à un registre n'est supposé. Cet état est propre
à l'instance API, sans persistance ; un redémarrage le perd. Les entrées expirées
sont nettoyées lors des appels suivants. La normalisation des chemins est celle
des routes existantes ; les alias symboliques ne sont pas regroupés.

Le frontend peut rendre la relance indisponible jusqu'à `resetAt`, puis proposer
un nouvel essai manuel. Le backend applique cette règle même si le client soumet
une requête avant l'échéance. La requête, les schémas partagés et le succès restent
inchangés.
