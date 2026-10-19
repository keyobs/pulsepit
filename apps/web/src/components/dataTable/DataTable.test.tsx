import { render, screen } from '@testing-library/react';
import { DataTable } from './DataTable';

interface Dep {
  name: string;
  latest: string;
}

const columns = [
  { key: 'name', header: 'Paquet', render: (row: Dep) => row.name },
  {
    key: 'latest',
    header: 'Latest',
    render: (row: Dep) => row.latest,
    mono: true,
  },
];

describe('DataTable', () => {
  it('renders headers and one row per item', () => {
    render(
      <DataTable
        columns={columns}
        rows={[
          { name: 'vite', latest: '7.1.9' },
          { name: 'react', latest: '19.0.0' },
        ]}
        getRowKey={(row) => row.name}
        emptyText="À jour"
      />,
    );
    expect(
      screen.getByRole('columnheader', { name: 'Paquet' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('7.1.9')).toHaveClass('mono');
  });

  it('shows the empty text when there are no rows', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowKey={(row: Dep) => row.name}
        emptyText="Toutes les dépendances sont à jour."
      />,
    );
    expect(
      screen.getByText('Toutes les dépendances sont à jour.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
