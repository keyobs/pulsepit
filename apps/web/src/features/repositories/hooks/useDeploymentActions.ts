import { bulkQueue } from '@api/bulkQueue';
import { checkDeployments } from '@api/repositories.api';
import { useKeyedAsyncAction } from '@hooks/useKeyedAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';

/** Vérification des déploiements configurés (online / offline) d'un dépôt ou de tous. */
export function useDeploymentActions() {
  const { showToast } = useToast();
  const actions = useKeyedAsyncAction(checkDeployments, {
    queue: bulkQueue,
    onError: (path, error) =>
      showToast(
        `Vérification impossible sur ${repositoryName(path)} : ${describeApiError(error)}`,
      ),
  });

  const runAll = async (paths: string[]) => {
    const { failed } = await actions.runMany(paths);
    showToast(
      failed === 0
        ? 'Déploiements vérifiés'
        : `Vérification : ${failed} en erreur`,
    );
  };

  return {
    stateOf: actions.stateOf,
    run: actions.run,
    runAll,
    isBusy: actions.isBusy,
  };
}
