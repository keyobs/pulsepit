import { installDependencies } from '@api/repositories.api';
import { useKeyedAsyncAction } from '@hooks/useKeyedAsyncAction';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';

/** Installation des dépendances d'un dépôt avec son gestionnaire détecté. */
export function useInstallActions() {
  const { showToast } = useToast();
  const actions = useKeyedAsyncAction(installDependencies, {
    onSuccess: (path, result) =>
      showToast(
        `Installation terminée : ${repositoryName(path)} (${result.command}, ${Math.round(result.durationMs / 1000)} s)`,
      ),
    onError: (path, error) =>
      showToast(
        `Installation impossible sur ${repositoryName(path)} : ${describeApiError(error)}`,
      ),
  });

  return { stateOf: actions.stateOf, run: actions.run };
}
