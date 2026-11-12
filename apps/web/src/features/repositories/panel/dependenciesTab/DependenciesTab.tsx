import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { Chip } from '@components/chip/Chip';
import { EmptyState } from '@components/emptyState/EmptyState';
import { Tabs } from '@components/tabs/Tabs';
import { useDisclosure } from '@hooks/useDisclosure';
import { useRetryDeadline } from '@hooks/useRetryDeadline';
import { describeApiError } from '@utils/describeApiError';
import { formatDateTime, formatTime } from '@utils/formatDate';
import { useMemo, useState } from 'react';
import { TbPackageImport, TbStethoscope } from 'react-icons/tb';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import { OutdatedTable } from './OutdatedTable';
import { PackageJsonViewer } from './PackageJsonViewer';
import { ALL_VIEW_ID, countStatus, toPackageViews } from './packageViews';
import { ToolchainInfo } from './ToolchainInfo';
import './dependenciesTab.less';

interface DependenciesTabProps {
  repository: Repository;
}

export const DependenciesTab = ({ repository }: DependenciesTabProps) => {
  const { outdated, install } = useRepositoryRuntime(repository.path);
  const manifest = useDisclosure();
  const { status, data, error, updatedAt } = outdated.state;
  const retryAt = useRetryDeadline(error);
  const views = useMemo(() => (data ? toPackageViews(data) : []), [data]);
  const [activeId, setActiveId] = useState(ALL_VIEW_ID);
  const view = views.find(({ id }) => id === activeId) ?? views[0];
  const showManifest =
    manifest.isOpen && view?.id !== ALL_VIEW_ID && !view?.technology;

  return (
    <div className="pp-dependencies-tab">
      <div className="pp-dependencies-tab-toolbar">
        <div className="pp-dependencies-tab-actions">
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
          {updatedAt && (
            <span className="pp-dependencies-tab-updated">
              Diagnostic du {formatDateTime(new Date(updatedAt).toISOString())}
            </span>
          )}
        </div>
        <ToolchainInfo repository={repository} />
      </div>

      {views.length > 1 && view && (
        <Tabs
          ariaLabel="Packages du dépôt"
          activeId={view.id}
          onChange={setActiveId}
          items={views.map(({ id, label, title, rows }) => {
            const count = countStatus(rows, 'outdated');
            return {
              id,
              label: (
                <span title={title}>
                  {label}
                  {count > 0 && (
                    <em className="pp-dependencies-tab-count">{count}</em>
                  )}
                </span>
              ),
            };
          })}
        />
      )}

      {status === 'error' && (
        <EmptyState>
          <Chip variant="bad">Échec</Chip> {describeApiError(error)}
          {retryAt && ` Nouvel essai possible à ${formatTime(retryAt)}.`}
        </EmptyState>
      )}
      {data === null && status !== 'error' && (
        <EmptyState>Aucun diagnostic lancé pour ce dépôt.</EmptyState>
      )}
      {view?.error && (
        <EmptyState>
          <Chip variant="bad">Échec</Chip> {view.error}
        </EmptyState>
      )}
      {view?.technology && (
        <EmptyState>
          Backend non Node ({view.technology}) : dépendances non analysées.
        </EmptyState>
      )}
      {data && view && !view.error && !view.technology && (
        <OutdatedTable manager={data.packageManager} rows={view.rows} />
      )}
      {showManifest && (
        <PackageJsonViewer
          key={view?.workspace ?? '.'}
          path={repository.path}
          workspace={view?.workspace ?? undefined}
        />
      )}
    </div>
  );
};
