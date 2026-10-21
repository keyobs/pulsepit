import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { Chip } from '@components/chip/Chip';
import { EmptyState } from '@components/emptyState/EmptyState';
import { useDisclosure } from '@hooks/useDisclosure';
import { describeApiError } from '@utils/describeApiError';
import { TbStethoscope } from 'react-icons/tb';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import { OutdatedTable } from './OutdatedTable';
import { PackageJsonViewer } from './PackageJsonViewer';
import './dependenciesTab.less';

interface DependenciesTabProps {
  repository: Repository;
}

export const DependenciesTab = ({ repository }: DependenciesTabProps) => {
  const { outdated } = useRepositoryRuntime(repository.path);
  const manifest = useDisclosure();
  const { status, data, error } = outdated.state;

  return (
    <div className="pp-dependencies-tab">
      <div className="pp-dependencies-tab-toolbar">
        <Button
          variant="primary"
          size="small"
          icon={<TbStethoscope />}
          loading={status === 'loading'}
          onClick={() => void outdated.run()}
        >
          Lancer le diagnostic
        </Button>
        <Button
          size="small"
          aria-expanded={manifest.isOpen}
          onClick={manifest.toggle}
        >
          {manifest.isOpen ? 'Masquer package.json' : 'Voir package.json'}
        </Button>
        <span className="pp-dependencies-tab-manager">
          Détecté : {repository.packageManager.name ?? 'aucun'}
        </span>
      </div>

      {status === 'error' && (
        <EmptyState>
          <Chip variant="bad">Échec</Chip> {describeApiError(error)}
        </EmptyState>
      )}
      {data === null && status !== 'error' && (
        <EmptyState>Aucun diagnostic lancé pour ce dépôt.</EmptyState>
      )}
      {data && <OutdatedTable dependencies={data.dependencies} />}
      {manifest.isOpen && <PackageJsonViewer path={repository.path} />}
    </div>
  );
};
