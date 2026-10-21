import { SegmentedControl } from '@components/segmentedControl/SegmentedControl';
import type { ViewMode } from '@constants/viewModes';
import { TbLayoutRows, TbList } from 'react-icons/tb';
import { useRepositoriesContext } from './context/useRepositoriesContext';
import './listHead.less';

const VIEW_OPTIONS = [
  {
    value: 'compact' as const,
    label: 'Vue compacte',
    icon: <TbList aria-hidden="true" />,
  },
  {
    value: 'detailed' as const,
    label: 'Vue détaillée',
    icon: <TbLayoutRows aria-hidden="true" />,
  },
];

/** Compteur de dépôts affichés et choix de la vue (compacte ou détaillée). */
export const ListHead = () => {
  const { list, filters, view } = useRepositoriesContext();
  const shown = filters.visibleRepositories.length;
  const total = list.repositories.length;

  const changeView = (mode: ViewMode) =>
    view.setViewMode(
      mode,
      filters.visibleRepositories.map((repository) => repository.path),
    );

  return (
    <div className="pp-list-head">
      <div className="pp-list-head-count" aria-live="polite">
        {shown} dépôt{shown > 1 ? 's' : ''}
        {shown !== total && ` sur ${total}`}
      </div>
      <SegmentedControl
        options={VIEW_OPTIONS}
        value={view.viewMode}
        onChange={changeView}
        ariaLabel="Mode d'affichage"
      />
    </div>
  );
};
