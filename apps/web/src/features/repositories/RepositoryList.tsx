import { Button } from '@components/button/Button';
import { Card } from '@components/card/Card';
import { EmptyState } from '@components/emptyState/EmptyState';
import { Spinner } from '@components/spinner/Spinner';
import { useRepositoriesContext } from './context/useRepositoriesContext';
import { RepositoryRow } from './row/RepositoryRow';
import './repositoryList.less';

export const RepositoryList = () => {
  const { list, filters } = useRepositoriesContext();

  if (list.status === 'error' && list.repositories.length === 0) {
    return (
      <Card
        title="Impossible de charger les dépôts"
        tone="alert"
        actions={<Button onClick={() => void list.reload()}>Réessayer</Button>}
      >
        {list.error?.message}
      </Card>
    );
  }

  if (list.repositories.length === 0) {
    return list.isLoading || list.status === 'idle' ? (
      <EmptyState>
        <Spinner /> Scan des dépôts en cours…
      </EmptyState>
    ) : (
      <EmptyState>Aucun dépôt Git trouvé dans les dossiers scannés.</EmptyState>
    );
  }

  if (filters.visibleRepositories.length === 0) {
    return <EmptyState>Aucun dépôt ne correspond au filtre.</EmptyState>;
  }

  return (
    <div className="pp-repository-list">
      {filters.visibleRepositories.map((repository) => (
        <RepositoryRow key={repository.path} repository={repository} />
      ))}
    </div>
  );
};
