import { getDeployments } from '@api/repositories.api';
import { useAsyncAction } from './useAsyncAction';

export const useDeployments = (path: string) =>
  useAsyncAction(() => getDeployments(path));
