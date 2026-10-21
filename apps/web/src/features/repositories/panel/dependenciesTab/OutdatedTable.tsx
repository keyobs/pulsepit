import type { OutdatedDependency } from '@api/types';
import {
  DataTable,
  type DataTableColumn,
} from '@components/dataTable/DataTable';

const COLUMNS: DataTableColumn<OutdatedDependency>[] = [
  { key: 'name', header: 'Paquet', render: (dependency) => dependency.name },
  {
    key: 'current',
    header: 'Actuelle',
    render: (dependency) => dependency.current ?? '—',
    mono: true,
  },
  {
    key: 'wanted',
    header: 'Wanted',
    render: (dependency) => dependency.wanted,
    mono: true,
  },
  {
    key: 'latest',
    header: 'Latest',
    render: (dependency) => dependency.latest,
    mono: true,
  },
];

interface OutdatedTableProps {
  dependencies: OutdatedDependency[];
}

export const OutdatedTable = ({ dependencies }: OutdatedTableProps) => (
  <DataTable
    columns={COLUMNS}
    rows={dependencies}
    getRowKey={(dependency) =>
      `${dependency.name}:${dependency.location ?? ''}`
    }
    emptyText="Toutes les dépendances sont à jour."
  />
);
