import { getBranches } from '@api/repositories.api';
import { useAsyncAction } from './useAsyncAction';

export const useBranches = (path: string) =>
  useAsyncAction(() => getBranches(path));
