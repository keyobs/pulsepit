import { pushBranch } from '@api/repositories.api';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { repositoryName } from '@utils/repositoryName';
import { useState } from 'react';
import { useRepositoriesContext } from '../context/useRepositoriesContext';

/** Push d'une branche locale vers origin, avec retour à l'utilisateur et rechargement de la liste. */
export function usePushAction(path: string) {
  const { showToast } = useToast();
  const { list } = useRepositoriesContext();
  const [isPushing, setIsPushing] = useState(false);

  const push = async (branch: string) => {
    setIsPushing(true);
    try {
      await pushBranch(path, branch);
      showToast(`${branch} poussée vers origin : ${repositoryName(path)}`);
      void list.reload();
    } catch (error) {
      showToast(`Échec du push de ${branch} : ${describeApiError(error)}`);
    } finally {
      setIsPushing(false);
    }
  };

  return { push, isPushing };
}
