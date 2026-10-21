import { useContext } from 'react';
import { RepositoriesContext } from './repositoriesContext';

export function useRepositoriesContext() {
  const context = useContext(RepositoriesContext);
  if (!context) {
    throw new Error(
      'useRepositoriesContext doit être utilisé dans un RepositoriesProvider.',
    );
  }
  return context;
}
