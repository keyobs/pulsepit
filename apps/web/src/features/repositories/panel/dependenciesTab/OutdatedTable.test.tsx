import type { OutdatedResponse } from '@api/types';
import { render, screen } from '@testing-library/react';
import { OutdatedTable, toPackageRows } from './OutdatedTable';

const report: OutdatedResponse = {
  path: '/home/user/Projets/app',
  packageManager: 'npm',
  dependencies: [
    {
      name: 'react',
      current: '19.1.0',
      wanted: '19.2.0',
      latest: '20.0.0',
      dependent: 'app',
      location: null,
    },
    {
      name: 'zod',
      current: '3.0.0',
      wanted: '3.1.0',
      latest: '4.0.0',
      dependent: 'api',
      location: '/home/user/Projets/app/apps/api',
    },
  ],
  packages: [
    {
      name: '@eas/client',
      section: 'dependencies',
      declared: '^1.0.0',
      installed: '1.2.0',
      wanted: null,
      latest: null,
      status: 'private',
    },
    {
      name: 'typescript',
      section: 'devDependencies',
      declared: '^5.0.0',
      installed: '5.9.2',
      wanted: '5.9.2',
      latest: '5.9.2',
      status: 'current',
    },
    {
      name: 'react',
      section: 'dependencies',
      declared: '^19.0.0',
      installed: '19.1.0',
      wanted: '19.2.0',
      latest: '20.0.0',
      status: 'outdated',
    },
  ],
  error: null,
};

describe('OutdatedTable', () => {
  it('lists outdated first, then current and private packages, with workspace extras', () => {
    expect(
      toPackageRows(report).map((row) => [row.name, row.status, row.workspace]),
    ).toEqual([
      ['react', 'outdated', null],
      ['zod', 'outdated', 'api'],
      ['typescript', 'current', null],
      ['@eas/client', 'private', null],
    ]);
  });

  it('summarises statuses and shows up-to-date packages', () => {
    render(<OutdatedTable report={report} />);
    expect(screen.getByText('2 à mettre à jour')).toBeInTheDocument();
    expect(screen.getByText('1 à jour')).toBeInTheDocument();
    expect(screen.getByText('1 privé(s)')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('Privé')).toHaveAttribute(
      'title',
      'Registre privé : non interrogé par le diagnostic',
    );
  });
});
