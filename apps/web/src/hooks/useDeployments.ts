import { getDeployments } from '@api/repositories.api';
import { useAsyncAction } from './useAsyncAction';

/** Cartes d'environnement d'un dépôt : configuration et métadonnées de déploiement, à la demande. */
export const useDeployments = (path: string) =>
  useAsyncAction(() => getDeployments(path));
