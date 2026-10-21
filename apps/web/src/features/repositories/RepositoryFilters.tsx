import { SegmentedControl } from '@components/segmentedControl/SegmentedControl';
import { REPOSITORY_FILTERS } from '@constants/repositoryFilters';
import { useRepositoriesContext } from './context/useRepositoriesContext';
import './repositoryFilters.less';

export const RepositoryFilters = () => {
  const { filters } = useRepositoriesContext();
  return (
    <div className="pp-repository-filters">
      <input
        className="pp-repository-filters-search"
        type="search"
        placeholder="Filtrer par nom ou chemin"
        aria-label="Filtrer"
        value={filters.query}
        onChange={(event) => filters.setQuery(event.target.value)}
      />
      <SegmentedControl
        options={REPOSITORY_FILTERS}
        value={filters.filter}
        onChange={filters.setFilter}
        ariaLabel="Filtre d'état"
      />
    </div>
  );
};
