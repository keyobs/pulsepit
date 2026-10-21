import { getWorkflows } from '@api/repositories.api';
import { useAsyncAction } from './useAsyncAction';

export const useWorkflows = (path: string) =>
  useAsyncAction(() => getWorkflows(path));
