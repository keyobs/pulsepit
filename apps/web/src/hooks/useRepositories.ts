import { listRepositories } from '@api/repositories.api';
import { useEffect } from 'react';
import { useAsyncAction } from './useAsyncAction';

/** Charge la liste des dépôts au montage, puis permet de la recharger. */
export function useRepositories() {
  const { data, status, error, isLoading, run } =
    useAsyncAction(listRepositories);

  useEffect(() => {
    void run();
  }, [run]);

  return {
    scanPaths: data?.scanPaths ?? [],
    repositories: data?.repositories ?? [],
    scanErrors: data?.scanErrors ?? [],
    status,
    error,
    isLoading,
    reload: () => run(),
  };
}
