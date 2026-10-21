# @keyobs/pulsepit-beacon

Métadonnées de déploiement pour les applications suivies dans Pulsepit.

Le package construit un document JSON contenant le nom de l'application, sa version,
son commit, son environnement et sa date de déploiement lorsqu'elle est connue.
Son générateur statique permet de publier ce document avec un site sur GitHub Pages,
Vercel ou tout autre hébergement statique.

Le package est développé dans le monorepo
[keyobs/pulsepit](https://github.com/keyobs/pulsepit/tree/main/packages/beacon)
et publié indépendamment sur GitHub Packages. Il n'a aucune dépendance d'exécution
au dashboard Pulsepit ou à un framework.

## Installation

Node.js 22.13 ou supérieur. Le package est ESM et fournit ses déclarations TypeScript.

Configurer le registre et l'authentification dans le projet consommateur :

```ini
@keyobs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

La valeur de `NODE_AUTH_TOKEN` est fournie par l'environnement, jamais inscrite dans
ce fichier. Installer la version publiée :

```sh
pnpm add -D @keyobs/pulsepit-beacon@0.1.1
```

Le générateur est une dépendance de développement : il s'exécute pendant le build,
et seul le fichier JSON est envoyé sur l'hébergement statique.

## Générer un fichier statique

Créer par exemple `scripts/generateBeacon.mjs` :

```js
import { writeBeaconManifest } from '@keyobs/pulsepit-beacon/static';

await writeBeaconManifest('dist/pulsepit-deployment.json', {
  name: 'mon-app',
  version: '1.0.0',
  env: 'production',
  commit: null,
  deployedAt: null,
});
```

Exécuter le script **après** le build du site, pour que le nettoyage du dossier de
sortie ne supprime pas le document :

```sh
vite build && node scripts/generateBeacon.mjs
```

L'application fournit explicitement ses métadonnées. Les environnements utilisés
par Pulsepit sont notamment `production` pour Production et `staging` pour Test.
Le script de l'application peut lire sa version depuis son `package.json` et le SHA
depuis son processus de livraison avant de les transmettre au générateur.

Le fichier est publié à côté des autres fichiers du site. Pour un site GitHub Pages
servi sous `/mon-app/`, il sera accessible sous
`/mon-app/pulsepit-deployment.json`.

## Construire uniquement le document

```js
import { createBeaconManifest } from '@keyobs/pulsepit-beacon';

const manifest = createBeaconManifest({
  name: 'mon-app',
  env: 'staging',
  version: '1.0.0',
});
```

Résultat :

```json
{
  "protocolVersion": 1,
  "app": {
    "name": "mon-app",
    "version": "1.0.0",
    "commit": null,
    "env": "staging",
    "deployedAt": null
  }
}
```

`name` et `env` sont obligatoires. `version`, `commit` et `deployedAt` sont
facultatifs et deviennent `null` s'ils sont inconnus. Un commit fourni doit être un
SHA Git complet. Une date fournie doit être une date ISO en UTC, terminée par `Z`.

Le package ne lit pas automatiquement Git ou les variables d'environnement.
La date du build n'est pas utilisée comme date de déploiement : `deployedAt` reste
`null` tant que le système de livraison ne fournit pas cette information.

## Tokens : GitHub Actions et Vercel

| Usage | Identifiant | Accès nécessaire |
| --- | --- | --- |
| Publier le package depuis Pulsepit | `GITHUB_TOKEN` automatique du workflow | `packages: write` |
| Installer depuis le workflow d'une application | `GITHUB_TOKEN` de ce workflow | `packages: read` et accès du dépôt au package |
| Installer pendant un build Vercel | Token GitHub personnel classique, fourni comme `NODE_AUTH_TOKEN` | `read:packages` et accès au package |

Pour Vercel, définir `NODE_AUTH_TOKEN` dans les variables d'environnement du projet,
pour les environnements qui construisent l'application. Le compte propriétaire du
token doit pouvoir lire le package. Un token de lecture existant peut être réutilisé
s'il possède cet accès ; Vercel n'a pas besoin du droit de publication.

Le jeton automatique d'un workflow GitHub est temporaire et fourni pour ce workflow.
Il ne remplace pas les identifiants de lecture du build Vercel.

Pour installer depuis un autre dépôt GitHub, accorder à ce dépôt l'accès en lecture
au package dans **Package settings → Manage Actions access**.

## Périmètre actuel

Le générateur écrit des métadonnées publiques et ne doit recevoir aucun secret.
Il ne mesure pas la santé de l'application, ne lance aucun ping et ne contacte pas
Pulsepit. La lecture de ce document et la vérification HTTP relèvent du backend
Pulsepit. Aucun serveur Node n'est requis sur l'hébergement du site statique.

## Développement et publication

Depuis `packages/beacon` :

```sh
npm ci
npm run build
npm test
```

Le workflow manuel **Publish beacon to GitHub Packages**, dans le dépôt Pulsepit,
compile et teste uniquement ce package puis publie son archive. La version est
définie dans son `package.json` ; chaque publication utilise une nouvelle version.
Ce README est inclus dans le package distribué.

Documentation des registres :
[GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[dépendances privées sur Vercel](https://vercel.com/kb/guide/using-private-dependencies-with-vercel).
