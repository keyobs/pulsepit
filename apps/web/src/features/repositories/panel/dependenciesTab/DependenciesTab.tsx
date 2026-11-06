import type { Repository, ToolVersion } from '@api/types';
import { Button } from '@components/button/Button';
import { Chip } from '@components/chip/Chip';
import { EmptyState } from '@components/emptyState/EmptyState';
import { useBeaconVersion } from '@hooks/useBeaconVersion';
import { useDisclosure } from '@hooks/useDisclosure';
import { useRetryDeadline } from '@hooks/useRetryDeadline';
import { describeApiError } from '@utils/describeApiError';
import { formatTime } from '@utils/formatDate';
import { TbPackageImport, TbStethoscope } from 'react-icons/tb';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import { OutdatedTable } from './OutdatedTable';
import { PackageJsonViewer } from './PackageJsonViewer';
import './dependenciesTab.less';

interface DependenciesTabProps {
  repository: Repository;
}

const sourceOf = (tool: ToolVersion | null) =>
  tool
    ? `Déclaré dans ${tool.source}`
    : 'Aucune version déclarée dans le dépôt';

export const DependenciesTab = ({ repository }: DependenciesTabProps) => {
  const { outdated, install } = useRepositoryRuntime(repository.path);
  const manifest = useDisclosure();
  const { status, data, error } = outdated.state;
  const beacon = useBeaconVersion(repository.path, repository.beacon.package);
  const retryAt = useRetryDeadline(error);
  const { toolchain } = repository;

  return (
    <div className="pp-dependencies-tab">
      <div className="pp-dependencies-tab-toolbar">
        <Button
          variant="primary"
          size="small"
          icon={<TbStethoscope />}
          loading={status === 'loading'}
          disabled={retryAt !== null}
          onClick={() => void outdated.run()}
        >
          Lancer le diagnostic
        </Button>
        <Button
          size="small"
          icon={<TbPackageImport />}
          loading={install.state.status === 'loading'}
          disabled={!repository.packageManager.name}
          title={
            repository.packageManager.name
              ? `${repository.packageManager.name} install dans le dépôt local`
              : 'Gestionnaire non détecté'
          }
          onClick={() => void install.run()}
        >
          Installer les dépendances
        </Button>
        <Button
          size="small"
          aria-expanded={manifest.isOpen}
          onClick={manifest.toggle}
        >
          {manifest.isOpen ? 'Masquer package.json' : 'Voir package.json'}
        </Button>
        <span className="pp-dependencies-tab-manager">
          <span title={sourceOf(toolchain.packageManager)}>
            {repository.packageManager.name ?? 'Gestionnaire non détecté'}
            {toolchain.packageManager && ` ${toolchain.packageManager.version}`}
          </span>
          {' · '}
          <span title={sourceOf(toolchain.node)}>
            Node {toolchain.node?.version ?? 'non précisé'}
          </span>
        </span>
        <span className="pp-dependencies-tab-beacon">
          Beacon :{' '}
          {!repository.beacon.package
            ? 'non détecté'
            : beacon.isLoading
              ? '…'
              : (beacon.version ?? 'déclaré, version inconnue')}
        </span>
      </div>

      {status === 'error' && (
        <EmptyState>
          <Chip variant="bad">Échec</Chip> {describeApiError(error)}
          {retryAt && ` Nouvel essai possible à ${formatTime(retryAt)}.`}
        </EmptyState>
      )}
      {data === null && status !== 'error' && (
        <EmptyState>Aucun diagnostic lancé pour ce dépôt.</EmptyState>
      )}
      {data && <OutdatedTable report={data} />}
      {manifest.isOpen && <PackageJsonViewer path={repository.path} />}
    </div>
  );
};
