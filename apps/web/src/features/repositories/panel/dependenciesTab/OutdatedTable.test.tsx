import type { OutdatedResponse } from '@api/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutdatedTable } from './OutdatedTable';
import { groupOf, toPackageViews } from './packageViews';

const report: OutdatedResponse = {
  path: '/home/user/Projets/app',
  packageManager: 'npm',
  dependencies: [],
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
  workspaces: [],
  error: null,
};

const monorepo: OutdatedResponse = {
  ...report,
  workspaces: [
    {
      name: '@app/api',
      path: 'apps/api',
      standalone: false,
      technology: null,
      packageManager: 'npm',
      error: null,
      packages: [
        {
          name: 'zod',
          section: 'dependencies',
          declared: '^3.0.0',
          installed: '3.0.0',
          wanted: '3.1.0',
          latest: '4.0.0',
          status: 'outdated',
        },
      ],
    },
  ],
};

describe('toPackageViews', () => {
  it('keeps a single view without workspaces, ordered by section', () => {
    const views = toPackageViews(report);
    expect(views).toHaveLength(1);
    expect(views[0].rows.map((row) => [row.name, groupOf(row)])).toEqual([
      ['react', 'dependencies'],
      ['typescript', 'dev dependencies'],
      ['@eas/client', 'private'],
    ]);
  });

  it('keeps a tab for a non-Node project', () => {
    const views = toPackageViews({
      ...report,
      workspaces: [
        {
          name: 'agent-gate',
          path: 'apps/agent-gate',
          standalone: true,
          technology: 'C# / .NET',
          packageManager: null,
          packages: [],
          error: null,
        },
      ],
    });
    expect(views.map(({ label, technology }) => [label, technology])).toEqual([
      ['all', null],
      ['Monorepo', null],
      ['agent-gate', 'C# / .NET'],
    ]);
  });

  it('adds all, root and one view per workspace', () => {
    const views = toPackageViews(monorepo);
    expect(views.map(({ id, label }) => [id, label])).toEqual([
      ['all', 'all'],
      ['root', 'Monorepo'],
      ['apps/api', 'api'],
    ]);
    expect(views[0].rows.map((row) => `${row.name} (${row.owner})`)).toEqual([
      'react (Monorepo)',
      'zod (api)',
      'typescript (Monorepo)',
      '@eas/client (Monorepo)',
    ]);
    expect(
      views[2].rows.map(({ name, workspace }) => [name, workspace]),
    ).toEqual([['zod', '@app/api']]);
  });
});

describe('OutdatedTable', () => {
  const rows = toPackageViews(report)[0].rows;

  it('shows a title row per section', () => {
    render(<OutdatedTable manager="npm" rows={rows} />);
    expect(
      screen
        .getAllByRole('columnheader')
        .filter((cell) => cell.getAttribute('scope') === 'colgroup')
        .map((cell) => cell.textContent),
    ).toEqual(['dependencies', 'dev dependencies', 'private']);
  });

  it('summarises statuses and shows up-to-date packages', () => {
    render(<OutdatedTable manager="npm" rows={rows} />);
    expect(screen.getByText('1 à mettre à jour')).toBeInTheDocument();
    expect(screen.getByText('1 à jour')).toBeInTheDocument();
    expect(screen.getByText('1 privé(s)')).toBeInTheDocument();
    expect(screen.getByText('Privé')).toHaveAttribute(
      'title',
      'Registre privé : non interrogé par le diagnostic',
    );
  });

  it('copies install commands, scoped to the workspace', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <OutdatedTable manager="npm" rows={toPackageViews(monorepo)[0].rows} />,
    );
    expect(
      screen.getByTitle('Copier : npm install typescript@5.9.2 -D'),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByTitle('Copier : npm install zod@4.0.0 -w @app/api'),
    );
    expect(writeText).toHaveBeenCalledWith('npm install zod@4.0.0 -w @app/api');

    await userEvent.click(screen.getByRole('button', { name: 'Cible' }));
    expect(writeText).toHaveBeenLastCalledWith('npm update');
  });

  it('copies commands run inside a standalone sub-project', () => {
    const standalone: OutdatedResponse = {
      ...monorepo,
      workspaces: [
        {
          ...monorepo.workspaces[0],
          path: 'apps/kiosk',
          standalone: true,
          packageManager: 'yarn',
        },
      ],
    };
    render(
      <OutdatedTable manager="npm" rows={toPackageViews(standalone)[2].rows} />,
    );
    expect(
      screen.getByTitle('Copier : cd apps/kiosk && yarn add zod@4.0.0'),
    ).toBeInTheDocument();
  });

  it('keeps the global upgrade command in headers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<OutdatedTable manager="npm" rows={rows} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cible' }));
    expect(writeText).toHaveBeenLastCalledWith('npm update');
  });
});
