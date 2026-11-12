import type { OutdatedResponse } from '@api/types';
import { Chip } from '@components/chip/Chip';
import {
  DataTable,
  type DataTableColumn,
} from '@components/dataTable/DataTable';
import { installCommand, UPGRADE_ALL_COMMANDS } from './packageCommand';
import { countStatus, groupOf, type PackageRow } from './packageViews';
import { VersionCopy } from './VersionCopy';

type Manager = OutdatedResponse['packageManager'];

const STATUS = {
  outdated: { label: 'À mettre à jour', variant: 'warn' },
  current: { label: 'À jour', variant: 'ok' },
  private: { label: 'Privé', variant: 'neutral' },
} as const;

const renderVersion = (
  manager: Manager,
  row: PackageRow,
  version: string | null,
  always = false,
) => {
  if (!version) return '—';
  if (!always && version === row.installed) return version;
  return (
    <VersionCopy
      label={version}
      command={installCommand(row.manager ?? manager, { ...row, version })}
    />
  );
};

const columns = (manager: Manager): DataTableColumn<PackageRow>[] => [
  {
    key: 'name',
    header: 'Package',
    render: (row) => (row.owner ? `${row.name} (${row.owner})` : row.name),
  },
  {
    key: 'installed',
    header: 'Installée',
    render: (row) => row.installed ?? '—',
    mono: true,
  },
  {
    key: 'wanted',
    header: (
      <VersionCopy
        label="Cible"
        command={UPGRADE_ALL_COMMANDS[manager].wanted}
      />
    ),
    render: (row) => renderVersion(manager, row, row.wanted, true),
    mono: true,
  },
  {
    key: 'latest',
    header: (
      <VersionCopy
        label="Dernière"
        command={UPGRADE_ALL_COMMANDS[manager].latest}
      />
    ),
    render: (row) => renderVersion(manager, row, row.latest),
    mono: true,
  },
  {
    key: 'status',
    header: 'État',
    render: (row) => (
      <Chip
        variant={STATUS[row.status].variant}
        title={
          row.status === 'private'
            ? 'Registre privé : non interrogé par le diagnostic'
            : undefined
        }
      >
        {STATUS[row.status].label}
      </Chip>
    ),
  },
];

interface OutdatedTableProps {
  manager: Manager;
  rows: PackageRow[];
}

export const OutdatedTable = ({ manager, rows }: OutdatedTableProps) => {
  const outdated = countStatus(rows, 'outdated');
  const privates = countStatus(rows, 'private');
  return (
    <>
      <div className="pp-dependencies-tab-summary">
        <Chip variant={outdated ? 'warn' : 'ok'}>
          {outdated} à mettre à jour
        </Chip>
        <Chip>{countStatus(rows, 'current')} à jour</Chip>
        {privates > 0 && <Chip>{privates} privé(s)</Chip>}
      </div>
      <DataTable
        columns={columns(manager)}
        rows={rows}
        getRowKey={(row) => row.key}
        getGroup={groupOf}
        emptyText="Aucune dépendance déclarée."
      />
    </>
  );
};
