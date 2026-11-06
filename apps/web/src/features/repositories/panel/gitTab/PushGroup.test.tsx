import { ToastProvider } from '@components/toast/ToastProvider';
import { jsonResponse, makeRepository } from '@test/fixtures';
import { render, screen } from '@testing-library/react';
import {
  RepositoriesContext,
  type RepositoriesContextValue,
} from '../../context/repositoriesContext';
import { PushGroup } from './PushGroup';

const repository = makeRepository();
const ready = { state: 'ready', canAttempt: true, reasons: [] };
const branch = (name: string) => ({
  name,
  isCurrent: name === 'main',
  upstream: null,
  checksId: null,
  policy: { directPush: 'allowed', requiredChecks: [] },
  pushAssessment: ready,
});
const settings = {
  settings: {
    scanPaths: null,
    rescan: { enabled: false, interval: '1h' },
    pushLocks: { all: false, branches: [], repositories: {} },
  },
  effectiveScanPaths: [],
  scanPathsSource: 'env',
  rescan: { lastStartedAt: null, lastFinishedAt: null, failures: [] },
};

describe('PushGroup', () => {
  const fetchMock = vi.fn();

  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  const renderWith = (names: string[]) => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse(
          url.includes('/settings')
            ? settings
            : url.includes('/branches')
              ? { path: repository.path, branches: names.map(branch) }
              : {},
        ),
      ),
    );
    render(
      <ToastProvider>
        <RepositoriesContext.Provider
          value={
            { list: { reload: vi.fn() } } as unknown as RepositoriesContextValue
          }
        >
          <PushGroup repository={repository} />
        </RepositoriesContext.Provider>
      </ToastProvider>,
    );
  };

  it('shows one lock per main and develop', async () => {
    renderWith(['main', 'develop']);
    expect(
      await screen.findByRole('button', { name: 'Push develop' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', {
        name: 'Verrouiller le push de main',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Verrouiller le push de develop' }),
    ).toBeInTheDocument();
  });

  it('hides develop when the branch does not exist', async () => {
    renderWith(['main']);
    expect(
      await screen.findByRole('button', {
        name: 'Verrouiller le push de main',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Push develop' })).toBeNull();
    expect(screen.queryByRole('button', { name: /de develop/ })).toBeNull();
  });
});
