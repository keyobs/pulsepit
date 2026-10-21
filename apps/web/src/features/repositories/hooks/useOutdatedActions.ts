import { bulkQueue } from '@api/bulkQueue';
import { getOutdated } from '@api/repositories.api';
import { useKeyedAsyncAction } from '@hooks/useKeyedAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';

/** Diagnostic des dépendances d'un dépôt ou de tous. */
export function useOutdatedActions() {
  const { showToast } = useToast();
  const actions = useKeyedAsyncAction(getOutdated, {
    queue: bulkQueue,
    onSuccess: (path, result) =>
      showToast(
        `Diagnostic terminé : ${repositoryName(path)} (${result.dependencies.length} à mettre à jour)`,
      ),
    onError: (path, error) =>
      showToast(
        `Diagnostic impossible sur ${repositoryName(path)} : ${describeApiError(error)}`,
      ),
  });

  const runAll = async (paths: string[]) => {
    const { succeeded, failed } = await actions.runMany(paths);
    showToast(
      failed === 0
        ? `Diagnostic terminé sur ${succeeded} dépôt${succeeded > 1 ? 's' : ''}`
        : `Diagnostic : ${succeeded} réussi${succeeded > 1 ? 's' : ''}, ${failed} en erreur`,
    );
  };

  return {
    stateOf: actions.stateOf,
    run: actions.run,
    runAll,
    isBusy: actions.isBusy,
  };
}
