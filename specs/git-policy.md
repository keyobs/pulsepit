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
