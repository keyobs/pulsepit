# Politique de push locale

`gitPolicy` expose les règles déclarées dans la configuration de Pulsepit.
L'inventaire `/api/repositories/hooks` décrit les fichiers Git/Husky présents ; il
ne déduit pas une politique de branches en interprétant du shell arbitraire.
L'absence de déclaration produit `POLICY_UNCONFIGURED`, avec une tentative de
push possible et les hooks existants conservés. Elle ne confirme aucune
permission de push, locale ou distante.

## Déclarer une règle

Dans `config.json`, sous `repositories[absolutePath]` :

```json
{
  "git": {
    "policy": {
      "default": {
        "directPush": "unknown",
        "requiredChecks": null
      },
      "branches": {
        "main": {
          "directPush": "forbidden",
          "requiredChecks": []
        },
        "master": {
          "directPush": "forbidden",
          "requiredChecks": []
        },
        "develop": {
          "directPush": "allowed",
          "requiredChecks": ["lint-fix", "test-run"]
        }
      }
    }
  }
}
```

Cet exemple décrit une convention particulière de dépôt, pas une règle implicite
appliquée à tous les projets. Une règle de branche remplace entièrement `default`.
Les identifiants de contrôles ne sont pas des commandes à exécuter.

L'exécuteur Pulsepit des contrôles n'étant pas encore livré, toute liste de
contrôles obligatoires non vide bloque le push avec `CHECK_RUNNER_UNAVAILABLE`.
`directPush: "allowed"` reste compatible avec cette obligation : la permission
est conditionnelle, elle ne signifie pas que les contrôles ont déjà réussi.
Le front utilise `pushAssessment.canAttempt` pour activer l'action.

Les hooks existants ne sont ni remplacés ni désactivés. Un hook qui inspecte HEAD
peut contrôler une autre branche que celle sélectionnée dans Pulsepit. Les règles
déclarées s'appliquent à la destination réelle du push ; leur mise en cohérence
avec le dépôt reste explicite. Les protections du serveur Git sont indépendantes.

Après modification du fichier de configuration, redémarrer l'API puis actualiser
les branches. Le fichier de configuration personnel reste hors du dépôt Git.

## Déclaration partageable dans le dépôt

Le format v1 proposé vit dans `.pulsepit/git-policy.json` :

```json
{
  "version": 1,
  "remote": "origin",
  "default": {
    "directPush": "unknown",
    "requiredChecks": null
  },
  "branches": {
    "main": { "directPush": "forbidden", "requiredChecks": [] },
    "master": { "directPush": "forbidden", "requiredChecks": [] },
    "develop": {
      "directPush": "allowed",
      "requiredChecks": ["lint-fix", "test-run"]
    }
  }
}
```

Le schéma `GitPolicyFile` est exporté par `@pulsepit/contracts`. `version` et
`remote` sont obligatoires ; l'absence de `default` signifie une règle inconnue,
`branches` absent signifie une table vide. Chaque règle présente est complète.
Les champs inconnus sont rejetés et aucune commande n'est acceptée dans ce
fichier. Les contrôles restent des identifiants, pas des résultats.

Le lecteur backend interne `readRepositoryGitPolicyFile` accepte uniquement ce
chemin fixe, un fichier régulier de 64 Kio maximum et un contenu JSON UTF-8 valide.
Il refuse les liens observés sur le fichier ou son dossier, vérifie les noms de
branches via Git et ne lance aucun hook. Une erreur donne `INVALID_PUSH_POLICY`,
sans contenu de fichier ni erreur système brute ; un fichier absent est distingué
d'un fichier invalide. Chaque worktree lit sa propre déclaration.

**État : raccordé aux routes et au précontrôle de push.** Le fichier est lu dans
le working tree courant, y compris ses modifications non commitées. Les règles
ne sont pas lues dans le commit de chaque branche sélectionnée. Une réponse
`/branches` utilise une seule lecture pour toutes ses entrées ; chaque push
relit sa propre déclaration avant de décider.

Un fichier valide, sans politique locale déclarée, produit
`source: "repository-file"`. Un fichier absent conserve le mécanisme de
configuration locale. Un fichier incorrect ou deux politiques présentes
simultanément produisent `INVALID_PUSH_POLICY` et bloquent le dépôt concerné,
sans empêcher les réponses concernant les autres dépôts. Il n'existe ni fusion
implicite ni priorité permettant d'affaiblir une règle.

Pour migrer, préparer et valider le fichier puis retirer explicitement la copie
`git.policy` de la configuration personnelle. Cette modification de configuration
nécessite un redémarrage de l'API. Le contenu du fichier du dépôt est ensuite
relu à chaque demande, sans redémarrage.

## Adaptateur pre-push

`scripts/hooks/pulsepit-pre-push.mjs` fournit un adaptateur Node autonome,
sans dépendance installée. Il doit être copié dans `.husky/pulsepit-pre-push.mjs`
puis appelé depuis le hook :

```sh
#!/usr/bin/env sh
exec node .husky/pulsepit-pre-push.mjs "$@"
```

Cet adaptateur reprend le flow d'izeetok : `lint:fix` lorsqu'il existe, puis
`test:run` lorsqu'il existe. Un échec du lint bloque toujours ; un échec des tests
bloque si la destination exige `test-run`, et reste consultatif sinon. Les
identifiants reconnus sont `lint-fix` et `test-run`. Un contrôle obligatoire
inconnu ou sans script correspondant bloque le push, sans lancer de commande
contenue dans la déclaration. Le gestionnaire suit les lockfiles : pnpm, Yarn,
Bun, sinon npm, comme le hook d'origine.

Toutes les références reçues sur stdin sont examinées avant les contrôles : une
seule destination interdite refuse l'opération entière. L'adaptateur prend en
charge `origin` et les références sources nommées transmises par Git ; une autre
remote ou une expression source non prise en charge est refusée. Les règles de
branches visent les destinations `refs/heads/*`, indépendamment de HEAD.

Pour des contrôles obligatoires, la source doit être la branche courante et son
SHA courant, avec un working tree propre. Le contexte est revérifié après le
lint et les tests, et le document de politique doit rester identique. Une
modification produite par `lint:fix` reste dans le working tree pour être revue ;
elle n'est ni commitée ni annulée automatiquement. Ces vérifications locales ne
remplacent pas un environnement isolé ni les protections CI du serveur.

Un fichier absent, invalide ou trop volumineux, un lien symbolique observé ou un
contexte non pris en charge entraîne un refus. L'adaptateur n'exécute pas les
scripts lors d'une simple lecture de politique par Pulsepit. Le backend conserve
son refus `CHECK_RUNNER_UNAVAILABLE` pour les obligations de contrôles : installer
un hook ne constitue pas une preuve utilisable par son futur exécuteur.

La copie du helper et le hook sont versionnés avec la déclaration dans le dépôt
cible. Si un outil de génération de hooks les remplace, leur intégration doit
être conservée dans sa configuration ; Pulsepit ne réécrit pas les hooks au scan.
