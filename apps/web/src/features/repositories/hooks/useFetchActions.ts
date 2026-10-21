import { bulkQueue } from '@api/bulkQueue';
import { fetchRepository } from '@api/repositories.api';
import { useKeyedAsyncAction } from '@hooks/useKeyedAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';

/** Fetch d'un dépôt ou de tous, avec retour à l'utilisateur et rechargement de la liste. */
export function useFetchActions(reload: () => Promise<unknown>) {
  const { showToast } = useToast();
  const actions = useKeyedAsyncAction(fetchRepository, {
    queue: bulkQueue,
    onSuccess: (path) => {
      showToast(`Fetch terminé : ${repositoryName(path)}`);
      void reload();
    },
    onError: (path, error) =>
      showToast(
        `Échec du fetch sur ${repositoryName(path)} : ${describeApiError(error)}`,
      ),
  });

  const runAll = async (paths: string[]) => {
    const { succeeded, failed } = await actions.runMany(paths);
    showToast(
      failed === 0
        ? `Fetch terminé sur ${succeeded} dépôt${succeeded > 1 ? 's' : ''}`
        : `Fetch : ${succeeded} réussi${succeeded > 1 ? 's' : ''}, ${failed} en erreur`,
    );
    await reload();
  };

  return {
    stateOf: actions.stateOf,
    run: actions.run,
    runAll,
    isBusy: actions.isBusy,
  };
}
