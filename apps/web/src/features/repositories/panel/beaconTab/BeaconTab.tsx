import type { Repository } from '@api/types';
import { Button } from '@components/button/Button';
import { Chip } from '@components/chip/Chip';
import { DataTable } from '@components/dataTable/DataTable';
import { BEACON_PACKAGE_NAME } from '@constants/beacon';
import { useBeaconVersion } from '@hooks/useBeaconVersion';
import { describeApiError } from '@utils/describeApiError';
import { TbStethoscope } from 'react-icons/tb';
import { useRepositoryRuntime } from '../../hooks/useRepositoryRuntime';
import './beaconTab.less';

interface BeaconTabProps {
  repository: Repository;
}

interface BeaconRow {
  installed: boolean;
  current: string;
  wanted: string;
  latest: string;
}

const UNKNOWN = '—';
const UP_TO_DATE = 'à jour';

export const BeaconTab = ({ repository }: BeaconTabProps) => {
  const installed = repository.beacon.package;
  const { outdated } = useRepositoryRuntime(repository.path);
  const declared = useBeaconVersion(repository.path, installed);
  const { status, data, error } = outdated.state;

  const outdatedRow = data?.dependencies.find(
    (dependency) => dependency.name === BEACON_PACKAGE_NAME,
  );
  const diagnosed = data !== null;
  const row: BeaconRow = {
    installed,
    current: outdatedRow?.current ?? declared.version ?? UNKNOWN,
    wanted:
      outdatedRow?.wanted ?? (diagnosed && installed ? UP_TO_DATE : UNKNOWN),
    latest:
      outdatedRow?.latest ?? (diagnosed && installed ? UP_TO_DATE : UNKNOWN),
  };

  return (
    <div className="pp-beacon-tab">
      {installed && (
        <div className="pp-beacon-tab-toolbar">
          <Button
            variant="primary"
            size="small"
            icon={<TbStethoscope />}
            loading={status === 'loading'}
            onClick={() => void outdated.run()}
          >
            Lancer le diagnostic
          </Button>
          {status === 'error' && (
            <span>
              <Chip variant="bad">Échec</Chip> {describeApiError(error)}
            </span>
          )}
        </div>
      )}
      <DataTable
        columns={[
          {
            key: 'status',
            header: 'Status',
            render: (r) =>
              r.installed ? (
                <Chip variant="ok">Installé</Chip>
              ) : (
                <Chip>Non détecté</Chip>
              ),
          },
          {
            key: 'current',
            header: 'Actuelle',
            render: (r) => r.current,
            mono: true,
          },
          {
            key: 'wanted',
            header: 'Wanted',
            render: (r) => r.wanted,
            mono: true,
          },
          {
            key: 'latest',
            header: 'Latest',
            render: (r) => r.latest,
            mono: true,
          },
        ]}
        rows={[row]}
        getRowKey={() => BEACON_PACKAGE_NAME}
        emptyText=""
      />
    </div>
  );
};
