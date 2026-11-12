import { createQueryClient } from '@api/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useOutdatedActions } from './useOutdatedActions';

const api = vi.hoisted(() => ({ getOutdated: vi.fn() }));
vi.mock('@api/repositories.api', () => api);
vi.mock('@hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const PATH = '/home/user/Projets/mon-app';
const REPORT = {
  path: PATH,
  packageManager: 'pnpm',
  dependencies: [],
  packages: [],
  workspaces: [],
  error: null,
};

describe('useOutdatedActions', () => {
  beforeEach(() => {
    api.getOutdated.mockReset().mockResolvedValue(REPORT);
  });

  it('runs only on demand and keeps the result in the cache', async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useOutdatedActions([PATH]), { wrapper });
    expect(first.result.current.stateOf(PATH).status).toBe('idle');
    expect(api.getOutdated).not.toHaveBeenCalled();

    await act(async () => void (await first.result.current.run(PATH)));
    await waitFor(() =>
      expect(first.result.current.stateOf(PATH).status).toBe('success'),
    );
    expect(first.result.current.stateOf(PATH).updatedAt).not.toBeNull();
    first.unmount();

    const second = renderHook(() => useOutdatedActions([PATH]), { wrapper });
    expect(second.result.current.stateOf(PATH).data).toEqual(REPORT);
    expect(api.getOutdated).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous result when a new run fails', async () => {
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useOutdatedActions([PATH]), {
      wrapper,
    });
    await act(async () => void (await result.current.runAll([PATH])));
    api.getOutdated.mockRejectedValue(new Error('timeout'));
    await act(async () => void (await result.current.run(PATH)));
    await waitFor(() =>
      expect(result.current.stateOf(PATH).status).toBe('error'),
    );
    expect(result.current.stateOf(PATH).data).toEqual(REPORT);
  });
});
