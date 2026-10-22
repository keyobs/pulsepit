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

Le raccordement Pulsepit n'installe pas de hook. L'adaptateur `pre-push` reste
l'étape suivante : il devra lire cette même déclaration, contrôler les références
de destination fournies par Git sur stdin et conserver les contrôles du dépôt.
L'inventaire Husky reste indépendant de cette déclaration.
