# Balise de déploiement Pulsepit

Date : 2026-10-21.

Statut : document de conception à relire. Le besoin d'affichage des déploiements est précisé ci-dessous ; les modes de collecte, le premier adaptateur et la publication npm restent ouverts. Discussion front/back au § 24 de `CONVENTION.md`. Ce document ne valide ni une nouvelle route du backend Pulsepit ni une publication.

## 1. Objectif

Permettre à Pulsepit de connaître l'identité de l'application réellement accessible dans chaque environnement : version, commit et état de santé déclaré.

Exemple : le dépôt local contient la version `2.5.0`, mais l'application de production répond avec `2.4.0` et un autre commit. Pulsepit peut afficher cette différence à partir de données observées sur l'application.

Une CI réussie prouve qu'un workflow s'est terminé avec succès. Une balise répondant depuis l'application renseigne l'instance qui a effectivement servi la requête. Ces informations sont complémentaires.

### Besoin utilisateur précisé : même vocabulaire pour tous les projets

Aucune distinction de vocabulaire, de modèle ou de parcours entre applications personnelles et professionnelles.

| Libellé dans Pulsepit | Information |
| --- | --- |
| Production | Environnement habituellement associé à `main`. |
| Test | Environnement habituellement associé à `develop`. |
| Branche | Branche associée explicitement à l'environnement. |
| URL de l'application | Adresse de l'application déployée. |
| Hébergeur | Nom explicite, par exemple Vercel, OVH, GitHub Pages ou un nom libre. |
| Lien hébergeur | Adresse de gestion du projet, facultative si aucune console n'existe. |
| Déployé le | Date et heure du déploiement, ou « Inconnu » en l'absence de source fiable. |
| Ping | Action de vérification HTTP de l'URL de l'application. |
| Dernière vérification | Date et heure du dernier contrôle HTTP, distinctes du déploiement. |

Les clés techniques existantes `production` et `staging` peuvent être présentées comme « Production » et « Test ». La correspondance branche/environnement est configurable par dépôt ; elle n'est pas déduite du fournisseur ou de la branche locale courante. Des environnements supplémentaires restent possibles.

Les liens et le ping fonctionnent sans balise. La balise apporte des métadonnées observées sur l'application ; elle ne remplace pas la configuration des liens ni la source de la date effective de déploiement.

## 2. Sources et périmètre de cette proposition

Ce document précise une première tranche du mécanisme décrit dans :

- [Spécifications générales, section 3.8](local_repo_dashboard_specifications.md).
- [Spécifications du front, F2 et F7](front.md).
- [Contrats front/back, demande D4](../CONVENTION.md).

La spécification générale prévoit aussi des métriques, du trafic et des signaux de sécurité. Proposition : commencer par l'identité du déploiement et sa santé déclarée, puis ajouter ces fonctions par étapes distinctes. Ce découpage reste à valider ; il ne modifie pas les spécifications générales.

## 3. Fonctionnement proposé : interrogation par Pulsepit

```text
Navigateur Pulsepit
        |
        | demande de consultation
        v
Backend local Pulsepit
        |
        | GET /__pulsepit + Authorization: Bearer <token>
        v
Application déployée intégrant la balise
        |
        | identité du déploiement + santé déclarée
        v
Backend Pulsepit : validation, normalisation, date de consultation
        |
        v
Navigateur Pulsepit : affichage du résultat
```

La communication part du backend local vers l'application accessible. Elle ne nécessite pas d'exposer la machine locale sur Internet. Le navigateur ne contacte pas directement la balise et ne reçoit jamais son token.

La notification envoyée par une CI constitue une autre architecture : elle nécessiterait un récepteur joignable par cette CI. Aucun webhook ou récepteur public n'est inclus dans cette proposition.

Pour la première tranche, la consultation est déclenchée par une action de l'utilisateur. Pas de polling, d'historique persistant ou de remontée automatique au démarrage du dashboard.

**Mise à jour du 2026-10-25 :** l'exclusion du polling est levée pour la surveillance périodique décrite au § 27. La balise reste passive ; seul le backend local interroge.

### Sites statiques et applications avec serveur

Deux modes de lecture sont à prévoir pour couvrir les hébergements utilisés :

| Mode | Intégration | Données observables |
| --- | --- | --- |
| `runtime` | Endpoint fourni par un adaptateur serveur. | Métadonnées du déploiement et santé déclarée au moment de la requête. |
| `static` | Fichier JSON publié avec les fichiers du site, par exemple `pulsepit-deployment.json`. | Métadonnées de l'artefact servi, sans mesure active de santé. |

GitHub Pages nécessite le mode statique ; un middleware Node ne s'y exécute pas. Le mode statique peut aussi convenir à d'autres hébergeurs. Pulsepit consulte toujours une URL explicitement configurée, sans détection automatique du mode par le nom de domaine.

Proposition de format statique : `protocolVersion: 1` et l'objet `app` décrit au § 7. Le document statique ne contient ni `health` ni `observedAt` : une date inscrite dans un fichier lors du build ne serait pas une observation de santé au moment de sa lecture. La date de lecture est ajoutée par Pulsepit. Le schéma statique distinct reste à valider avant codage.

Générer ce fichier pendant le build peut fournir version et commit, mais pas la date exacte de mise en ligne. `deployedAt` reste `null` tant que cette date n'est pas fournie par un mécanisme de livraison fiable. Aucun champ obligatoire n'est rempli avec une date de substitution.

## 4. Package npm

Nom retenu pour la publication : `@keyobs/pulsepit-beacon`, sous le propriétaire GitHub du dépôt `keyobs/pulsepit`. Le package reste dans `packages/beacon` ; aucun dépôt dédié n’est nécessaire. La publication distante n’a pas encore été effectuée.

Le code serait développé dans `packages/beacon`. Créer un package dans le monorepo ne le publie pas : les premiers essais peuvent utiliser une archive produite avec `npm pack` ou l'outil équivalent du projet consommateur.

La publication npm sera une étape explicite après validation de l'installation et de l'intégration. L'adaptateur serveur est une dépendance d'exécution de l'application suivie. Un générateur de fichier statique peut être un outil de build uniquement ; il ne nécessite pas de processus Node en production.

Contraintes proposées :

- Utilisable sans installer le dashboard, son backend ou ses outils de développement.
- Aucun import d'un package privé du monorepo dans l'artefact distribué.
- JavaScript compilé et déclarations TypeScript inclus dans l'archive.
- Dépendances d'exécution limitées ; aucun framework serveur imposé par le cœur.
- Aucun démarrage de serveur, collecteur ou tâche périodique à l'import du package.
- Version du package indépendante de la version de l'application observée.

La version minimale de Node, les exports ESM et l'éventuel support CommonJS seront fixés selon la première application cible.

## 5. Architecture du package

Séparer trois responsabilités :

| Partie | Responsabilité |
| --- | --- |
| Protocole | Définir le format et la version des données échangées. |
| Cœur | Construire un instantané à partir des métadonnées explicitement fournies par l'application. |
| Adaptateur HTTP | Enregistrer la route, vérifier l'authentification et produire la réponse HTTP dans le framework cible. |
| Générateur statique | Produire les métadonnées publiques de l'artefact, sans serveur ni collecte de santé. |

Si le mode serveur est retenu en premier, commencer avec un seul adaptateur, choisi après identification de l'application à instrumenter. Les adaptateurs Fastify, Express, Next et HTTP natif sont des extensions possibles ; leur développement simultané n'est pas requis. Le mode statique peut être développé en premier sans adaptateur serveur.

Les types publics du protocole doivent être distribuables avec la balise. Le schéma de validation consommé par Pulsepit doit rester cohérent avec ce protocole ; son emplacement exact et ses dépendances seront arrêtés avant implémentation. La balise ne doit pas dépendre du package actuellement privé `@pulsepit/contracts` pour fonctionner dans une application externe.

## 6. Métadonnées fournies par l'application

| Champ | Provenance et sens |
| --- | --- |
| `name` | Nom stable explicitement configuré par l'application. |
| `version` | Version de l'artefact construit, ou `null` si inconnue. |
| `commit` | SHA complet du commit ayant produit l'artefact, ou `null` si inconnu. |
| `env` | Environnement explicitement configuré, par exemple `production` ou `staging`. |
| `deployedAt` | Date de déploiement fournie par le système de livraison, ou `null`. |

Ces informations sont injectées lors du build ou du déploiement, puis passées à la balise. L'application peut les lire depuis ses propres variables d'environnement ; le package ne parcourt ni ne restitue l'environnement du processus.

La balise n'exécute pas Git au démarrage ou à chaque requête. Un artefact de production peut ne contenir aucun dossier `.git`.

La date de démarrage du processus, la date du commit et la date de consultation ne sont pas utilisées comme substituts à `deployedAt`. Un redémarrage ne doit pas faire apparaître un nouveau déploiement.

## 7. Endpoint de la balise : proposition de contrat

Mode serveur `runtime` : route par défaut `GET /__pulsepit`, configurable par l'application à l'intégration. Le format statique proposé au § 3 a son propre schéma.

Le format suivant est une proposition à valider, distincte des routes locales de Pulsepit :

```json
{
  "protocolVersion": 1,
  "observedAt": "2026-10-21T10:30:00.000Z",
  "app": {
    "name": "mon-app",
    "version": "2.4.0",
    "commit": "48c5fe048c5fe048c5fe048c5fe048c5fe048c5fe0",
    "env": "production",
    "deployedAt": null
  },
  "health": {
    "status": "unknown"
  }
}
```

Règles proposées :

- `protocolVersion` vaut `1`. Il versionne le format d'échange, pas le package ou l'application.
- Les champs présentés sont obligatoires dans la réponse. `version`, `commit` et `deployedAt` sont nullables ; une donnée inconnue reste `null`.
- Les noms et versions sont des chaînes de longueur bornée ; les limites exactes seront fixées avec le schéma.
- `commit`, lorsqu'il est présent, identifie un commit complet. Le format pris en charge sera explicitement validé ; l'interface pourra l'abréger pour l'affichage.
- Les dates sont des chaînes ISO 8601 en UTC. `observedAt` est la date de création de l'instantané selon l'horloge de l'application.
- `health.status` vaut `ok`, `degraded` ou `unknown`. La capacité à répondre ne suffit pas à déclarer la base de données et tous les services sains.
- Sans indicateur métier fourni par l'application, la santé reste `unknown`. Le mécanisme de fourniture d'un état métier sera choisi avec l'adaptateur ; aucun check actif implicite n'est lancé.
- Une balise joignable peut répondre avec une santé `degraded` : accessibilité HTTP et santé métier sont deux informations différentes.

### Comportement HTTP proposé

| Situation | Réponse |
| --- | --- |
| Balise active, authentification valide, instantané disponible | 200 et document JSON, y compris si la santé est `degraded`. |
| Authentification absente ou invalide | 401 et erreur générique. |
| Balise désactivée | Route non enregistrée ; normalement 404 selon le routeur de l'application. |
| Instantané impossible à produire | 503 et erreur générique, sans détails internes. |

Les erreurs portent des messages anglais. Réponse JSON avec `Content-Type: application/json` et `Cache-Control: no-store`. La balise ne modifie pas les en-têtes ni les réponses des autres routes de l'application.

## 8. Authentification et isolation

Pour le mode serveur `runtime`, conformément aux spécifications générales : activation explicite, désactivation par défaut hors développement et token obligatoire dès que la balise est active. Aucun token par défaut ou codé en dur.

Le mode `static` constitue une proposition complémentaire à valider : un fichier public sur GitHub Pages ne permet pas de vérifier un token côté serveur. Il ne doit contenir que des métadonnées que le propriétaire accepte de rendre publiques, jamais un secret. Pulsepit n'envoie pas de token à une source statique publique. Si les métadonnées doivent rester privées, utiliser une source réellement protégée ; aucun token ne doit être embarqué dans le JavaScript ou le JSON public.

Le transport utilise HTTPS en dehors des essais locaux. En mode serveur, le token circule dans l'en-tête `Authorization`, jamais dans l'URL. Il est fourni séparément à l'application suivie et au backend local Pulsepit.

Le contrôle d'authentification précède la production de l'instantané. Le token attendu et les erreurs internes ne sont jamais inclus dans les réponses ou les logs de la balise. La configuration invalide est détectée lors de l'intégration, avec un message sans secret ; le comportement exact sera fixé avec le premier adaptateur.

La première version n'expose ni variables d'environnement, ni chemins du serveur, ni stacks, ni corps ou en-têtes de requêtes, ni informations sur les utilisateurs.

Une erreur de balise reste limitée à sa route. Aucun hook global capturant les exceptions non gérées, aucun remplacement des gestionnaires d'erreurs de l'application et aucune action de déploiement.

## 9. Configuration locale dans Pulsepit

Reprise de la forme envisagée dans les spécifications générales :

```json
{
  "repositories": {
    "/home/user/Projets/mon-app": {
      "beacon": {
        "production": {
          "mode": "runtime",
          "url": "https://app.example.com/__pulsepit",
          "tokenEnv": "PULSEPIT_TOKEN_MON_APP"
        }
      }
    }
  }
}
```

`tokenEnv` désigne une variable de l'environnement du backend Pulsepit. Le fichier JSON ne contient pas le secret lui-même. Des tokens distincts par application ou environnement sont recommandés.

Pour une source statique publique, proposition : `mode: "static"` et l'URL complète du fichier, sans `tokenEnv`. Le mode et les règles du schéma de configuration restent à valider avant implémentation.

Le backend actuel ne charge pas encore cette section : le chargeur de configuration devra être étendu et validé. Aucun endpoint du navigateur ne doit permettre de choisir librement une URL distante ou d'envoyer le token.

## 10. Lecture et restitution par le backend Pulsepit

Une tranche séparée définira dans `CONVENTION.md` la route de consultation et ses schémas partagés, à valider avec le front avant codage.

Comportement attendu :

1. Vérifier le dépôt local demandé et l'environnement configuré.
2. Résoudre côté serveur le mode, l'URL et, si nécessaire, le token de la balise.
3. Interroger la source configurée avec un budget de temps et une taille de réponse bornés, sans redirection implicite ni retry automatique ; authentifier le mode serveur, sans token pour un fichier statique public.
4. Valider le protocole et les champs reçus avant de les transmettre.
5. Ajouter une date de consultation côté Pulsepit, distincte de `observedAt`.
6. Retourner au front des données publiques et des états d'erreur explicites.

Les délais, limites et règles de concurrence restent à définir avant implémentation. Les erreurs doivent distinguer : absence de configuration, token serveur absent, refus d'authentification, indisponibilité réseau, timeout et réponse incompatible. Aucune de ces erreurs ne signifie automatiquement que le déploiement a échoué.

Le monitoring HTTP simple reste disponible pour les applications sans balise. La balise ne change pas silencieusement la forme de sa réponse existante.

## 11. Affichage et comparaison des versions

Pour chaque environnement, afficher l'identité remontée, la date de consultation, l'accessibilité de la balise et sa santé déclarée. Une erreur de consultation doit rester visible ; une ancienne observation éventuelle doit être signalée comme ancienne.

La comparaison se fait avec la branche configurée pour chaque environnement (`main`, `develop`, ou une autre branche explicite) :

- Versions différentes : afficher les deux valeurs sans déduire un nombre de commits.
- SHA différents : ils sont différents, sans conclure automatiquement que la production est en retard.
- Calcul d'avance ou de retard uniquement si les objets Git nécessaires sont disponibles et comparables localement.
- Aucun fetch automatique pour compléter cette comparaison.

**Exposé sur demande explicite de l'utilisateur le 2026-10-22.** `GET /api/repositories/deployments?path=…` fournit désormais `comparison` sur chaque environnement. Le schéma partagé `DeploymentCommitComparison` rend cet objet obligatoire et valide la cohérence de l'état et des compteurs. La référence est strictement `refs/heads/<branche configurée>`, sans repli vers HEAD ou une référence distante. Son SHA est capturé avant les calculs pour identifier précisément la base de comparaison.

Les compteurs sont vus depuis le déploiement : `behind` compte les commits de la branche absents du déploiement ; `ahead` compte ceux du déploiement absents de la branche. Les résultats distinguent même commit, retard, avance, divergence et état inconnu. Une version différente, un SHA absent ou un historique sans ancêtre commun ne suffisent pas à déclarer un retard.

L'état inconnu conserve des compteurs `null` avec une raison explicite. Un clone shallow non identique reste inconnu dans cette première tranche ; une égalité de SHA demeure confirmable. Le moteur gère les worktrees, désactive les références de remplacement Git et interdit le chargement réseau implicite d'objets manquants. Le budget global est de cinq secondes par comparaison, avec sorties bornées. La route limite les calculs locaux à quatre en parallèle par requête et conserve l'ordre des environnements. Les observations intermédiaires de balise/date restent distinctes du résultat final ; une erreur de date fournisseur n'empêche pas la comparaison d'un SHA de balise valide.

En cas de plusieurs instances ou d'un déploiement progressif, l'observation décrit l'instance ayant répondu. Une seule requête ne prouve pas que toutes les instances exécutent la même version. En mode statique, le fichier peut aussi être servi depuis un cache ; l'observation décrit les métadonnées reçues, sans preuve de convergence de tous les points de présence.

La source de `deployedAt` doit être présentée explicitement dans le contrat Pulsepit à définir avec le front : système de livraison, API de déploiement de l'hébergeur, ou absence de donnée. Un workflow générique réussi et un simple ping ne renseignent pas automatiquement ce champ. Le nom et le lien de l'hébergeur viennent de la configuration locale, y compris en l'absence de balise.

## 12. Hors de la première tranche proposée

- Publication npm et automatisation des releases.
- Notifications CI, récepteur public, push vers la machine locale et SSE.
- Historique des déploiements et agrégation de plusieurs instances.
- Mémoire, CPU, retard de boucle d'événements et uptime multi-instance.
- Compteurs de trafic, collecte d'erreurs et signaux de sécurité.
- Adaptateurs pour tous les frameworks dès la première version.
- Déploiement, rollback ou modification de l'application depuis Pulsepit.

## 13. Validation ciblée

Ajouter puis exécuter uniquement les tests de la tranche mise en œuvre :

- Cœur : métadonnées fournies, champs inconnus à `null`, dates et version du protocole.
- Adaptateur : activation, authentification, réponse et isolation des erreurs.
- Générateur statique : métadonnées publiques uniquement, aucune santé active, aucun secret, date de déploiement inconnue conservée à `null`.
- Client Pulsepit : transport simulé, succès, erreurs d'accès, timeout, JSON invalide et version de protocole non prise en charge.
- Distribution : inspection de l'archive et installation dans une petite application externe au workspace avant publication.

Pas d'accès à une production réelle, de publication npm ou de suite complète de tests pour valider les premières modifications locales.

## 14. Décisions attendues et étapes

1. Valider avec le front le contrat de déploiement au § 24 de `CONVENTION.md`, avec le même vocabulaire pour tous les projets.
2. Identifier la première application et choisir la première source : fichier statique, endpoint serveur ou API de déploiement.
3. Valider la provenance de la date de déploiement, le contrat minimal et les règles d'authentification du mode choisi.
4. Créer le package local avec son cœur et le premier mode retenu : adaptateur serveur ou générateur statique.
5. Tester l'installation dans l'application cible avec une archive locale.
6. Convenir de la route backend avec le front, puis implémenter sa consultation.
7. Valider les informations affichées sur un environnement choisi par l'utilisateur.
8. Préparer et autoriser séparément la publication npm.

## 15. Avancement du package et moment d'intégration — 2026-10-21

La configuration des cartes de déploiement, les contrats partagés et le ping ciblé sont implémentés côté Pulsepit. Ils fonctionnent sans balise.

Le cœur du package `@keyobs/pulsepit-beacon` est créé dans `packages/beacon`. Son API `createBeaconManifest` construit le document commun `protocolVersion` et `app` à partir de métadonnées explicitement fournies. Le package n'a aucune dépendance d'exécution et ne lit ni Git, ni fichier, ni environnement du processus. Les SHA complets sont validés, les dates UTC sont normalisées et les valeurs inconnues restent `null`.

Ce cœur ne crée pas encore de fichier, de route ou de check de santé. Son format commun peut alimenter le futur générateur statique ou être intégré dans la réponse d'un adaptateur serveur. Il ne fournit pas automatiquement une date de déploiement.

Ordre concret pour la suite :

1. Choisir une application cible et son mode d'intégration.
2. Développer le générateur statique ou l'adaptateur serveur correspondant.
3. Ajouter le package à cette application depuis une archive locale et fournir ses métadonnées au build ou à la livraison. Pour un générateur statique, l'installation peut se limiter aux dépendances de développement ; pour un adaptateur serveur, elle est nécessaire à l'exécution.
4. Définir puis raccorder la lecture de cette source par le backend Pulsepit, dans le respect du contrat avec le front.
5. Vérifier la réponse de l'application déployée avant d'envisager la publication npm.

**Vérification du cœur :** quatre nouveaux tests réussis ; compilation TypeScript et contrôle Biome du package réussis. Une archive contenant uniquement `package.json`, le JavaScript compilé et ses déclarations a été installée hors ligne dans une application temporaire extérieure au workspace. L'import ESM et la construction du manifeste y fonctionnent sans les autres packages Pulsepit. Aucun test existant relancé, aucun appel à une application réelle, aucune publication npm.

À cette étape de validation initiale, le manifeste du package était privé. La préparation de publication au § 17 retire cette restriction locale ; la visibilité du package sur GitHub reste à gérer dans GitHub Packages après sa création.

## 16. Première intégration statique : izeetok

Application choisie par l'utilisateur : `/home/keyobs/apollo/izeetok`, SPA React/Vite. La branche `develop` est publiée sur GitHub Pages (Test) et `main` sur Vercel (Production).

Le package expose maintenant `@keyobs/pulsepit-beacon/static` et sa fonction `writeBeaconManifest(outputPath, options)`. Elle valide les métadonnées avant d'écrire le JSON et ne devine aucune valeur depuis le système. Deux nouveaux tests vérifient la génération, le remplacement du fichier et l'absence d'écrasement en cas de métadonnées invalides ; ils sont réussis.

Dans la branche locale `feat/pulsepit-beacon` d'izeetok, une archive est ajoutée comme dépendance de développement. Le script `scripts/generateBeacon.mjs` est exécuté après le build Vite et génère `dist/pulsepit-deployment.json`. Il fournit le nom/version de l'application, le contexte d'environnement et le commit construit. GitHub Pages reçoit explicitement `staging` dans le workflow ; Vercel fournit son propre contexte de build. Sans plateforme, l'environnement du document local est `development`.

Le document ne contient aucun token. La date `deployedAt` reste `null` car la génération précède la mise en ligne. Les sources de date issues des plateformes de déploiement seront traitées séparément.

L'installation locale et le build Pages sont vérifiés. Le fichier est accessible sous `/izeetok/pulsepit-deployment.json` dans une preview locale, avec un contenu JSON valide. Les métadonnées de Production sont vérifiées avec un contexte Vercel simulé, sans déploiement réel.

À faire : convenir puis implémenter la configuration de lecture par Pulsepit et le collecteur statique ; récupérer les dates de déploiement depuis des sources fiables. Aucun push, déploiement ou publication npm n'a été effectué.


## 17. Publication depuis le monorepo vers GitHub Packages

Décision utilisateur : conserver le package dans ce dépôt et le distribuer par un registre. L'archive locale installée dans izeetok est une validation technique temporaire, pas le mode de distribution définitif.

### Identité et contenu

* Nom : `@keyobs/pulsepit-beacon`, version initiale `0.1.0`.
* Dépôt associé : `https://github.com/keyobs/pulsepit`, sous-dossier `packages/beacon`.
* Registre de publication : `https://npm.pkg.github.com`, déclaré dans `publishConfig`.
* Exports : `@keyobs/pulsepit-beacon` et `@keyobs/pulsepit-beacon/static`.
* Fichiers distribués : JavaScript compilé, déclarations TypeScript et générateur statique. Aucun code d'application, test, secret ou configuration locale n'est empaqueté.
* Aucune dépendance d'exécution ou dépendance privée au workspace.

`private: false` autorise la publication npm du package ; ce champ ne définit pas sa visibilité sur GitHub Packages. Les applications et contrats privés du monorepo ne sont pas publiés par ce workflow.

### Workflow et reproductibilité

Fichier : `.github/workflows/publish-beacon.yml`.

Le workflow est déclenché manuellement depuis GitHub Actions, sur `main` de `keyobs/pulsepit`. Il installe uniquement les dépendances de build de `packages/beacon`, avec son `package-lock.json` autonome et `npm ci --ignore-scripts`. Il n'installe ni le front ni le backend Pulsepit. Le monorepo conserve ses commandes pnpm habituelles.

Il compile puis exécute les tests du package beacon uniquement, construit une archive de ce build et publie cette même archive. Aucun événement push ou release ne déclenche automatiquement une publication dans cette première configuration. Le job dispose de `contents: read` et `packages: write` ; le jeton automatique `GITHUB_TOKEN` est fourni à la seule étape de publication via `NODE_AUTH_TOKEN`.

La version vient de `packages/beacon/package.json`. Une nouvelle livraison du package nécessite d'incrémenter cette version ; une version publiée ne doit pas être réutilisée pour un contenu différent. Le hook `prepack` compile le package lors d'un empaquetage local normal ; le workflow utilise `--ignore-scripts` pour empaqueter le build déjà vérifié.

### Première publication puis installation dans izeetok

1. Relire, committer puis pousser les fichiers du package et le workflow dans le dépôt Pulsepit, selon les étapes autorisées par l'utilisateur.
2. Une fois le workflow présent sur `main`, ouvrir Actions → « Publish beacon to GitHub Packages » → Run workflow sur `main`.
3. Vérifier que `@keyobs/pulsepit-beacon@0.1.0` est disponible dans GitHub Packages et accorder au dépôt `keyobs/izeetok` l'accès Actions en lecture au package.
4. Vérifier l'accès de lecture de Vercel au package avec son token serveur. Aucun token n'est committé.
5. Remplacer dans izeetok la dépendance `file:vendor/...` par la version publiée, actualiser le lockfile avec pnpm et remplacer l'import du script par `@keyobs/pulsepit-beacon/static`.
6. Retirer l'archive temporaire lorsque le registre est effectivement utilisable, puis vérifier l'installation avec le lockfile figé et le build.

Configuration de registre côté consommateur, sans secret :

```ini
@keyobs:registry=https://npm.pkg.github.com
```

L'authentification est fournie séparément par la CI. GitHub Actions utilise `GITHUB_TOKEN` avec `packages: read` et l'accès du dépôt consommateur au package. Vercel utilise un identifiant de lecture approprié ; son mécanisme actuel `NODE_AUTH_TOKEN` pour GitHub Packages est à vérifier pour ce package précis. Le nom du scope change : l'ancienne archive de validation `@pulsepit/beacon` n'est pas la publication finale.

Commande d'installation après disponibilité de la version :

```sh
pnpm add -D @keyobs/pulsepit-beacon@0.1.1
```

La dépendance reste de développement pour le générateur statique, qui n'est exécuté qu'au build.

### Vérifications de cette tranche

Installation autonome par `npm ci` et compilation réussies. Uniquement les deux nouveaux tests de `packages/beacon/tests/publication.test.mjs` sont exécutés localement : identité du package et indépendance du workspace ; inspection de l'archive, installation hors ligne dans un consommateur extérieur et exécution des deux exports. Ils sont réussis. Les six tests des étapes précédentes n'ont pas été relancés pendant cette intervention ; le workflow de publication exécutera les tests du seul package avant publication.

Le YAML est parsé et le déclenchement manuel, le répertoire de travail et les permissions de publication sont vérifiés. Le workflow distant et les droits réels du registre ne sont pas encore vérifiés par une publication. Aucun push, déclenchement distant ou publication n'a été effectué.

Sources techniques : [publication Node.js depuis GitHub Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages), [registre npm GitHub Packages et accès entre dépôts](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry), [dépendances privées sur Vercel](https://vercel.com/kb/guide/using-private-dependencies-with-vercel).


## 18. README du package et identifiants Vercel

Correction demandée par l'utilisateur : le package possède son propre `packages/beacon/README.md`, inclus explicitement dans les fichiers publiés. Le README de l'application à la racine du monorepo n'est pas modifié. Le README dédié présente l'installation, les deux exports, la génération statique, les limites de la date de déploiement et l'authentification des consommateurs.

La version préparée est `0.1.1`, synchronisée dans le manifeste et son lockfile. Une publication déjà effectuée en `0.1.0` n'est pas écrasée : le workflow publiera une nouvelle version incluant la documentation dédiée.

Pour Vercel, prévoir un token GitHub personnel classique avec `read:packages`, appartenant à un compte ayant accès au package. Il est fourni au projet Vercel via `NODE_AUTH_TOKEN`, pour les environnements qui installent la dépendance. Le token de lecture déjà utilisé par izeetok peut convenir s'il a accès au nouveau package. Le `GITHUB_TOKEN` automatique de publication reste propre à GitHub Actions et ne fournit pas d'identifiant au build Vercel.

Vérification : uniquement le nouveau test `packages/beacon/tests/readme.test.mjs`, réussi. Il empaquette le package, extrait le README de l'archive et vérifie son contenu exact ainsi que la cohérence des versions du manifeste et du lockfile. L'attente d'archive du test de publication existant est adaptée au README ajouté, sans relancer ce test. Aucun ancien test exécuté ; aucune publication effectuée dans cette tranche.

## 19. Installation de la version publiée dans izeetok

Après confirmation de publication par l'utilisateur, `@keyobs/pulsepit-beacon@0.1.1` est téléchargé depuis GitHub Packages et installé dans izeetok comme dépendance de développement exacte. Le lockfile utilise la résolution du registre ; l'import du script de build utilise désormais `@keyobs/pulsepit-beacon/static`. L'archive locale de validation est retirée.

Le build Pages et les métadonnées générées sont vérifiés avec cette version réellement installée. La génération dans un contexte Vercel simulé est également vérifiée. La date reste `null` tant qu'aucune source de livraison ne la fournit. Aucun test existant exécuté, aucun commit, push ou déploiement de l'intégration pendant cette étape. La branche locale d'intégration reste `feat/pulsepit-beacon`.

## 20. Lecture des documents statiques par Pulsepit

Le contrat du § 30 de `CONVENTION.md` est validé par le front. La configuration canonique de chaque environnement accepte maintenant `metadata: { "type": "static", "url": "https://.../pulsepit-deployment.json" }`. Ces paramètres restent côté serveur et sont exclus des réponses de configuration publique.

La route dédiée lit les sources à la demande, valide protocole et environnement, puis expose version et commit observés avec la date de fin de consultation. Les limites sont de cinq secondes par source, 64 Kio et quatre lectures simultanées. Les erreurs restent partielles par environnement ; elles ne modifient pas le statut du ping. Cinq nouveaux tests simulés sont réussis, et le service est également vérifié en lecture seule sur les deux balises en ligne d'izeetok. Aucun ancien test relancé.

`deployedAt` ne change pas si le document servi contient `null`, comme actuellement sur izeetok. Une étape distincte doit obtenir la date depuis les données de déploiement GitHub Pages/Vercel et l'associer au déploiement servi. Le backend pourra alors fournir `deploymentSource: "provider"`, sans exiger de réécrire le fichier du site après sa publication. La configuration de ces collecteurs de dates et de leurs accès API reste à définir ; voir § 31 de `CONVENTION.md`.

## 21. Collecteur de dates GitHub Pages

Un collecteur indépendant obtient la date de confirmation d'un déploiement GitHub correspondant au SHA réellement servi, à l'environnement GitHub, à la branche configurée et à l'URL complète de l'application. Il retient le statut de réussite courant et le plus récent parmi les correspondances consultées ; il ignore les tentatives échouées, les déploiements inactifs et les URL d'autres applications. L'heure de création d'une demande de déploiement ne sert pas de date de mise en ligne.

La consultation est limitée aux dix déploiements filtrés retournés sur la première page et aux dix statuts de chacun, avec un budget total de cinq secondes et 256 Kio maximum par réponse. Aucune pagination automatique ni redirection. La date peut rester inconnue lorsque les preuves ne sont pas disponibles dans cette fenêtre ou ont été supprimées par GitHub. L'API GitHub est construite côté serveur ; aucun URL distant de la réponse n'est suivi. L'éventuel jeton de lecture est fourni explicitement par le caller et ne fait pas partie du résultat.

Les sept nouveaux tests du collecteur sont réussis, ainsi que TypeScript API et Biome ciblé. Une vérification réelle anonyme sur Pages d'izeetok retrouve la confirmation `2026-10-21T13:00:36.000Z`, soit le 21 octobre 2026 à 15 h 00 min 36 s à Paris. Aucun ancien test relancé.

Le raccordement est maintenant validé par le front et implémenté dans la route existante. Le paramètre serveur privé `deploymentDate: { type: 'github-pages', environment: 'github-pages' }`, distinct de la source statique et de l'identifiant Pulsepit `staging`, est validé au démarrage et exclu des réponses de liste/détail. Les champs publics restent `deployedAt`, `deploymentSource: 'provider'`, `metadataCheckedAt`, `metadataError`. Version et commit lus sur la balise sont conservés si le fournisseur échoue ; une date explicite de la balise reste prioritaire avec provenance `delivery`. Aucun appel fournisseur sans SHA servi et URL, ni lors du scan ou du ping. L'enrichissement limite les consultations à quatre environnements simultanés et lit l'origin local une seule fois par requête concernée.

Les six nouveaux tests de `deployment-date-integration.test.ts` passent : validation et confidentialité de la configuration ; enrichissement via la route avec jeton réservé à GitHub ; erreurs partielles et conservation des métadonnées ; priorité des dates explicites et absence de collecte sans preuves ; absence de correspondance et origin non-GitHub ; limite de concurrence et ordre préservé. TypeScript API et Biome ciblé réussis, sans relancer les tests des étapes précédentes.

La configuration locale `/home/keyobs/.config/pulsepit/config.json`, auparavant absente, est créée avec les deux balises d'izeetok et le collecteur Pages pour `staging`. Une vérification réelle de la route complète avec cette configuration retourne `deployedAt: '2026-10-21T13:00:36.000Z'`, `deploymentSource: 'provider'` et aucune erreur pour Test. Production conserve une date inconnue en attendant le collecteur Vercel. Redémarrer l'API pour charger cette configuration, puis actualiser l'onglet Déploiement. Vercel reste l'étape fournisseur suivante.

## 22. Collecteur Vercel indépendant

Le service `vercel-deployment.service.ts` est implémenté séparément du raccordement HTTP. Il résout le domaine HTTPS configuré dans l'API Vercel, vérifie le déploiement associé (projet, commit servi, branche configurée, cible Production et état disponible), puis relit le domaine pour détecter un changement d'association pendant la consultation. Les métadonnées GitHub et GitLab sont acceptées, sans origin GitHub obligatoire. Les routages par chemin, domaines redirigés, microfrontends et déploiements staged/rolling ne sont pas pris en charge dans cette version.

La date est `ready` : disponibilité initiale du déploiement actuellement servi. Elle ne prétend pas dater une promotion ou un rollback ultérieur ; aucune date de création du build ou de modification générale de l'alias n'est substituée. Cette sémantique est validée par le front au § 33 de la discussion locale.

Le token Vercel est fourni explicitement au service et réservé à `api.vercel.com`, sans suivi des URL du document ni des redirections HTTP. Trois requêtes maximum, budget commun de cinq secondes et limite de 256 Kio par réponse. Résultat limité à une date nullable et une erreur assainie ; aucun corps Vercel, secret ou paramètre interne n'est retourné. L'absence de token donne `VERCEL_TOKEN_REQUIRED`, sans appel réseau.

Les huit tests ajoutés à l'étape du collecteur passent. Le raccordement est maintenant implémenté dans la route existante : configuration privée `deploymentDate: { type: 'vercel', projectId, teamId? }`, lecture de `VERCEL_TOKEN` côté serveur, propagation jusqu'au collecteur. Le projet doit être un identifiant `prj_...`, l'équipe facultative un identifiant `team_...` ; les champs supplémentaires, dont les secrets dans le JSON, sont refusés. Ces paramètres restent absents des réponses liste/détail. La lecture de l'origin n'est nécessaire que pour les environnements GitHub Pages éligibles, pas pour Vercel. Les credentials GitHub et Vercel restent séparés et ne sont jamais envoyés aux balises publiques.

Seuls les six nouveaux tests de `vercel-deployment-integration.test.ts` sont exécutés dans cette étape, tous réussis : lecture du token et confidentialité de la configuration ; validation des sources ; enrichissement d'un projet Vercel lié à GitLab ; réponse mixte GitHub Pages/Vercel et séparation des tokens ; erreurs partielles sans perte des métadonnées ; priorité des dates de livraison et absence d'appel sans preuves. TypeScript API et Biome ciblé réussis. Aucun test de l'étape précédente relancé.

La configuration réelle de Production est maintenant effectuée. Le token est fourni dans le `.env` de Pulsepit, application qui interroge Vercel. La résolution authentifiée de `izeetok.vercel.app` confirme le projet `prj_1oSRI7VpoVv3el22FQ1270BoVW9s` ; aucun identifiant d'équipe supplémentaire n'est nécessaire avec cet accès. La source est ajoutée à l'environnement Production dans `/home/keyobs/.config/pulsepit/config.json`, après sauvegarde et validation, sans modifier Test ni les autres réglages. Aucun secret n'est inscrit dans ce JSON.

Vérification manuelle en lecture seule de la route complète avec la configuration réelle : HTTP 200, Production `2026-10-21T13:02:27.725Z` pour le commit `b4727f8ff070b1003329da89f3e8f29a6c4084b3`, Test `2026-10-21T13:00:36.000Z` pour le commit `520dff16bacefd51d0c659d50a688ea3240e150f`, provenance `provider` et aucune erreur pour les deux cartes. Cela correspond respectivement à 15 h 02 min 27 s et 15 h 00 min 36 s à Paris le 21 octobre 2026. Aucun test existant relancé pour cette seule configuration. Redémarrer l'API pour charger le token et le fichier de configuration, puis actualiser l'onglet Déploiement.

Sources : [résolution d'un alias](https://vercel.com/docs/rest-api/aliases/get-an-alias), [lecture d'un déploiement](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url), [champ ready](https://github.com/vercel/sdk/blob/main/docs/models/deployments.md).

## 23. Objet beacon local par dépôt

L'utilisateur choisit une détection locale et impose un objet `beacon`, distinct d'une observation en ligne : `package: boolean`, `configuration: 'missing' | 'partial' | 'ok' | 'invalid'`, `active: boolean`. La proposition de booléen du § 34 de la discussion locale est remplacée par cet objet au § 35. Le nom demandé `active` est conservé.

`package` confirme une déclaration non vide dans `dependencies` ou `devDependencies` du manifeste racine du working tree, indépendamment de la configuration. Une déclaration non confirmable donne `false`. Un nom de package applicatif, un script, le sous-package du monorepo, une dépendance transitive/peer/optional ou `node_modules` seul ne suffisent pas. Aucun script ni appel distant n'intervient dans le calcul.

`configuration` vaut `missing` sans source `metadata`, `partial` si certains seulement des environnements configurés ont une source, `ok` si tous en possèdent (au moins un), `invalid` si les paramètres du dépôt sont rejetés. Une URL d'application ou une source de date d'hébergeur ne suffit pas. `active = package && (configuration === 'partial' || configuration === 'ok')` ; il ne décrit pas l'accessibilité en ligne.

L'objet est validé par le front au § 35 et désormais obligatoire dans le schéma partagé `Repository`. `RepositoryBeacon` est exporté par `@pulsepit/contracts` ; le service utilise ce type partagé. La liste et le détail enrichissent les dépôts avec le même calcul local. Vérification réelle de `GET /api/repositories/detail` pour izeetok : HTTP 200 et `{ package: true, configuration: 'ok', active: true }`, sans aucun appel réseau. Les URL et paramètres de collecte restent privés.

Seuls les quatre nouveaux tests `repository-beacon-routes.test.ts` sont exécutés pour ce raccordement : cohérence liste/détail et tous les états ; diagnostics limités aux dépôts découverts, maintien des erreurs de scan et désactivation des cibles invalides ; prise en compte des modifications non committées et des manifestes illisibles ; rejet du booléen précédent et des champs obligatoires manquants par le contrat partagé. Tous réussis. Compilation des contrats, TypeScript API/front et Biome ciblé réussis. Les attentes et objets explicites d'un ancien test de contrat API et la fixture commune du front sont adaptés sans relancer ces tests. Aucun composant d'interface modifié par le back, aucun commit.

## 24. Isolation des configurations incorrectes par dépôt

Le chargeur accepte l'option `isolateInvalidRepositories: true`, désormais activée au démarrage de l'API. Les paramètres incorrects d'un dépôt ne bloquent plus le serveur : ils produisent un diagnostic serveur assaini `INVALID_REPOSITORY_CONFIGURATION`, avec liens et sources entièrement désactivés pour ce dépôt. Les dépôts valides restent disponibles. Une collision de chemins normalisés invalide le dépôt concerné, indépendamment de l'ordre des entrées. Les chemins relatifs sont signalés et ne créent aucune cible de collecte.

Le fichier global illisible, du JSON mal formé ou un conteneur `repositories` invalide restent fatals. Le mode strict par défaut est conservé pour les outils qui valident un fichier avant enregistrement. Les diagnostics par dépôt sont retournés en interne dans `errors` et journalisés au démarrage, sans corps de configuration ni credentials. Ils sont transmis du démarrage aux routes et exposés dans `scanErrors` pour les seuls dépôts découverts, avec le code `INVALID_REPOSITORY_CONFIGURATION`. Le détail expose `beacon.configuration: 'invalid'` ; aucun chemin configuré hors du périmètre découvert n'est ajouté aux erreurs publiques.

Seuls huit nouveaux tests sont exécutés dans cette étape : sept dans `repository-config-isolation.test.ts` (quarantaine et conservation des voisins ; collisions de chemins ; paramètres hérités et fournisseurs incorrects ; chemins relatifs et clé spéciale ; erreurs globales ; absence de collecte depuis un dépôt rejeté ; états indépendants de l'objet), puis un démarrage réel dans `repository-config-startup.test.ts`. Ce dernier confirme HTTP 200 sur health, disponibilité du dépôt valide, conservation des diagnostics locaux du dépôt invalide, absence de cibles pour ses consultations/pings, et absence de secret dans les logs. TypeScript API et Biome ciblé réussis. Aucun ancien test relancé, aucun commit.

## 25. Sécurité du beacon statique et frontière avec les scripts locaux

Constat de lecture du code au 2026-10-22, sans audit exhaustif : le package actuel construit les champs explicites `name`, `version`, `commit`, `env`, `deployedAt`, puis son export statique écrit le JSON à une destination fournie par l'application. Il n'ouvre aucun serveur, n'envoie aucune télémétrie, ne lit pas automatiquement les variables d'environnement et ne possède aucune dépendance d'exécution. Il reste du code exécuté pendant le build : la protection du compte de publication et le contrôle des versions installées demeurent nécessaires.

Le fichier statique est public, même si le package provient d'un registre privé. Il expose l'identité/version et le SHA d'un déploiement ; leur publication doit être acceptable pour chaque application. Le SHA seul ne donne pas accès à un dépôt privé. Pour des applications professionnelles dont ces informations sont confidentielles, utiliser une source effectivement protégée. Une clé embarquée dans le JSON ou le JavaScript public ne fournit pas cette protection.

Le lecteur Pulsepit valide le protocole et le format, borne la réponse à 64 Kio et le budget à cinq secondes, refuse les redirections et n'envoie pas les tokens GitHub/Vercel aux sources statiques. Ces mesures ne prouvent pas l'intégrité d'une application compromise et ne constituent pas une politique réseau complète contre les requêtes vers des destinations indésirables. Les destinations configurées restent une frontière de confiance ; les besoins d'intranet des applications professionnelles devront être préservés lors de tout durcissement réseau.

Point distinct du beacon, corrigé le 2026-10-22 : les commandes Git et diagnostics de dépendances de l'API reçoivent maintenant un environnement construit à partir de listes explicites, au lieu d'hériter automatiquement de `process.env`. Les tokens API GitHub/Vercel et les variables inconnues restent dans le processus Pulsepit. Git conserve l'environnement opérationnel et l'agent SSH ; les variables dédiées d'authentification de registre restent réservées aux diagnostics npm/pnpm/Yarn Modern. Les hooks s'exécutent toujours lors des opérations Git qui les déclenchent. Une telle réduction d'environnement n'isole pas un hook malveillant des fichiers et droits accessibles au même compte utilisateur ; ne pas présenter cette mesure comme une sandbox.

Un service local prépare l'inventaire des hooks effectifs en lecture seule, y compris les wrappers Husky et les worktrees, sans interpréter leur politique de branches. Le raccordement HTTP est une étape distincte soumise au contrat front/back. Seuls les neuf nouveaux tests environnement/découverte sont exécutés ; ils passent, avec TypeScript API et Biome ciblé. Vérification réelle sur betbasile : trois hooks Husky découverts sans exécution, accès GitHub en lecture conservé avec l'environnement filtré. Aucun push réel ni suite existante exécutés.

## 27. Surveillance périodique des balises (v1)

Décision utilisatrice du 2026-10-25 : voir dans Pulsepit qu'un site est down, lorsque Pulsepit tourne sur sa machine. Aucune notification externe pour le moment.

Principe : la balise reste passive. Elle n'envoie rien, ne lance aucune tâche et le package est inchangé en mode statique. Le backend local relit la source `metadata` déjà configurée, à intervalle régulier. Envoyer depuis l'application suivie exigerait une tâche active dans celle-ci et un récepteur exposé sur Internet ; c'est exclu pour des raisons de sécurité.

Périmètre v1 :

* Lecture de la balise uniquement ; pas de ping de l'URL de l'application.
* Activation/désactivation et intervalle paramétrables par environnement, dans la configuration serveur.
* État courant uniquement (en ligne, down depuis, dernière vérification, cause), en mémoire ; pas d'historique.
* Mêmes limites que le lecteur actuel (§ 20).

Une balise statique ne déclare aucune santé métier : « up » signifie que le bon artefact est servi et lisible, pas que l'application fonctionne entièrement.

Contrat front/back : demande D7, § 57 de `CONVENTION.md`, à valider par le back. L'affichage sur les cartes Déploiement sera traité après livraison du back.
