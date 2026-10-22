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

## Déclaration partageable dans le dépôt : préparation

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

**État : préparé, pas encore raccordé aux routes ou aux hooks.** Le fichier ne
remplace pas encore la configuration Pulsepit utilisée en production. La nouvelle
provenance `repository-file` et la gestion de deux déclarations concurrentes sont
proposées au front dans `CONVENTION.md` avant raccordement. Aucun hook existant
n'est modifié automatiquement. L'adaptateur `pre-push` devra contrôler les
références de destination fournies par Git sur stdin et conserver les contrôles
du dépôt ; l'inventaire Husky reste indépendant de cette déclaration.
