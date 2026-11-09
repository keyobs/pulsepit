import { jsonResponse } from '@test/fixtures';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderBrowser } from './FolderBrowser';

const listing = (path: string, names: string[]) => ({
  path,
  parent: path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/',
  directories: names.map((name) => ({
    name,
    path: `${path === '/' ? '' : path}/${name}`,
    isGitRepo: name === 'repo',
  })),
  truncated: false,
});

describe('FolderBrowser', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('navigates into a folder and picks it', async () => {
    fetchMock.mockImplementation((url: string) => {
      const path = new URL(url, 'http://x').searchParams.get('path');
      return Promise.resolve(
        jsonResponse(
          path === '/home/me/work'
            ? listing('/home/me/work', ['repo'])
            : listing('/home/me', ['work']),
        ),
      );
    });
    const onPick = vi.fn();
    render(<FolderBrowser onPick={onPick} onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'work' }));
    expect(await screen.findByLabelText('Dépôt Git')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Choisir ce dossier' }),
    );

    expect(onPick).toHaveBeenCalledWith('/home/me/work');
  });

  it('shows a readable error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Cannot read', code: 'EACCES' }, 403),
    );
    render(<FolderBrowser onPick={vi.fn()} onClose={vi.fn()} />);

    expect(
      await screen.findByText('Accès refusé à ce dossier.'),
    ).toBeInTheDocument();
  });
});
