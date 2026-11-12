import type { OutdatedResponse, PackageDependency } from '@api/types';
import { Chip } from '@components/chip/Chip';
import {
  DataTable,
  type DataTableColumn,
} from '@components/dataTable/DataTable';
import { installCommand, UPGRADE_ALL_COMMANDS } from './packageCommand';
import { VersionCopy } from './VersionCopy';

interface PackageRow {
  key: string;
  name: string;
  installed: string | null;
  wanted: string | null;
  latest: string | null;
  status: PackageDependency['status'];
  section: PackageDependency['section'] | null;
  workspace: string | null;
}

type Manager = OutdatedResponse['packageManager'];

const STATUS = {
  outdated: { label: 'À mettre à jour', variant: 'warn' },
  current: { label: 'À jour', variant: 'ok' },
  private: { label: 'Privé', variant: 'neutral' },
} as const;
const ORDER = { outdated: 0, current: 1, private: 2 };

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
      command={installCommand(manager, { ...row, version })}
    />
  );
};

const columns = (manager: Manager): DataTableColumn<PackageRow>[] => [
  {
    key: 'name',
    header: 'Package',
    render: (row) =>
      row.workspace ? `${row.name} (${row.workspace})` : row.name,
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

/** Paquets du package.json racine, plus les paquets obsolètes des workspaces. */
export function toPackageRows(report: OutdatedResponse): PackageRow[] {
  const rows: PackageRow[] = report.packages.map((dependency) => ({
    key: dependency.name,
    name: dependency.name,
    installed: dependency.installed,
    wanted: dependency.wanted,
    latest: dependency.latest,
    status: dependency.status,
    section: dependency.section,
    workspace: null,
  }));
  const root = new Set(report.packages.map(({ name }) => name));
  for (const dependency of report.dependencies) {
    if (root.has(dependency.name)) continue;
    rows.push({
      key: `${dependency.name}:${dependency.location ?? dependency.dependent ?? ''}`,
      name: dependency.name,
      installed: dependency.current,
      wanted: dependency.wanted,
      latest: dependency.latest,
      status: 'outdated',
      section: null,
      workspace: dependency.dependent,
    });
  }
  return rows.sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

interface OutdatedTableProps {
  report: OutdatedResponse;
}

export const OutdatedTable = ({ report }: OutdatedTableProps) => {
  const rows = toPackageRows(report);
  const count = (status: PackageRow['status']) =>
    rows.filter((row) => row.status === status).length;
  return (
    <>
      <div className="pp-dependencies-tab-summary">
        <Chip variant={count('outdated') ? 'warn' : 'ok'}>
          {count('outdated')} à mettre à jour
        </Chip>
        <Chip>{count('current')} à jour</Chip>
        {count('private') > 0 && <Chip>{count('private')} privé(s)</Chip>}
      </div>
      <DataTable
        columns={columns(report.packageManager)}
        rows={rows}
        getRowKey={(row) => row.key}
        emptyText="Aucune dépendance déclarée."
      />
    </>
  );
};
