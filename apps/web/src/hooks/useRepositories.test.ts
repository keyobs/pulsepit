import { makeRepository } from '@test/fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRepositories } from './useRepositories';

const listRepositories = vi.hoisted(() => vi.fn());
vi.mock('@api/repositories.api', () => ({ listRepositories }));

describe('useRepositories', () => {
  // Les accolades comptent : vitest appelle comme nettoyage toute fonction renvoyée par beforeEach.
  beforeEach(() => {
    listRepositories.mockReset();
  });

  it('loads the repositories on mount', async () => {
    listRepositories.mockResolvedValue({
      scanPaths: ['/home/user/Projets'],
      repositories: [makeRepository()],
      scanErrors: [],
    });
    const { result } = renderHook(() => useRepositories());
    expect(result.current.repositories).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.repositories).toHaveLength(1);
    expect(result.current.scanPaths).toEqual(['/home/user/Projets']);
    expect(listRepositories).toHaveBeenCalledTimes(1);
  });

  it('exposes the error when the load fails', async () => {
    listRepositories.mockRejectedValue(
      new Error("Impossible de joindre l'API locale."),
    );
    const { result } = renderHook(() => useRepositories());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe(
      "Impossible de joindre l'API locale.",
    );
    expect(result.current.repositories).toEqual([]);
  });

  it('reloads on demand and keeps the previous list while loading', async () => {
    listRepositories.mockResolvedValueOnce({
      scanPaths: [],
      repositories: [makeRepository()],
      scanErrors: [],
    });
    const { result } = renderHook(() => useRepositories());
    await waitFor(() => expect(result.current.status).toBe('success'));
    let finish!: (value: unknown) => void;
    listRepositories.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    act(() => {
      void result.current.reload();
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.repositories).toHaveLength(1);
    await act(async () =>
      finish({ scanPaths: [], repositories: [], scanErrors: [] }),
    );
    expect(result.current.repositories).toHaveLength(0);
  });
});
