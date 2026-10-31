import { ToastProvider } from '@components/toast/ToastProvider';
import { jsonResponse, makeRepository } from '@test/fixtures';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RepositoriesContext,
  type RepositoriesContextValue,
} from '../repositories/context/repositoriesContext';
import { SettingsDialog } from './SettingsDialog';

const response = {
  settings: {
    scanPaths: null,
    rescan: { enabled: false, interval: '1h' },
    pushLocks: { all: false, branches: [], repositories: {} },
  },
  effectiveScanPaths: ['/home/user/Projets'],
  scanPathsSource: 'env',
  rescan: { lastStartedAt: null, lastFinishedAt: null, failures: [] },
};

describe('SettingsDialog', () => {
  const fetchMock = vi.fn();
  const reload = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = () =>
    render(
      <ToastProvider>
        <RepositoriesContext.Provider
          value={
            {
              list: { repositories: [makeRepository()], reload },
            } as unknown as RepositoriesContextValue
          }
        >
          <SettingsDialog onClose={onClose} />
        </RepositoriesContext.Provider>
      </ToastProvider>,
    );

  it('saves edited settings and reloads the repository list', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(response)));
    renderDialog();

    await userEvent.type(
      await screen.findByLabelText('Chemin absolu du dossier'),
      '/home/user/Work',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await userEvent.click(
      screen.getByRole('checkbox', { name: /Fetch de tous/ }),
    );
    await userEvent.type(screen.getByPlaceholderText('main, develop'), 'main');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      scanPaths: ['/home/user/Work'],
      rescan: { enabled: true, interval: '1h' },
      pushLocks: { all: false, branches: ['main'], repositories: {} },
    });
    expect(reload).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the server error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'Scan path is not an accessible directory' },
          422,
        ),
      );
    onClose.mockReset();
    renderDialog();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enregistrer' }),
    );

    expect(
      await screen.findByText('Scan path is not an accessible directory'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
