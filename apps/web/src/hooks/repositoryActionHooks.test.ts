import { createQueryClient } from '@api/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useBranches } from './useBranches';
import { useDeployments } from './useDeployments';
import { usePackageManifest } from './usePackageManifest';
import { useWorkflows } from './useWorkflows';

const api = vi.hoisted(() => ({
  fetchRepository: vi.fn(),
  pushBranch: vi.fn(),
  getBranches: vi.fn(),
  getOutdated: vi.fn(),
  getPackage: vi.fn(),
  checkDeployments: vi.fn(),
  getWorkflows: vi.fn(),
  getDeployments: vi.fn(),
}));
vi.mock('@api/repositories.api', () => api);

const PATH = '/home/user/Projets/mon-app';

const queryWrapper = () => {
  const client = createQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

describe('repository action hooks', () => {
  beforeEach(() => {
    for (const mock of Object.values(api))
      mock.mockReset().mockResolvedValue({ ok: true });
  });

  it('useBranches loads the local branches on demand', async () => {
    const { result } = renderHook(() => useBranches(PATH));
    expect(api.getBranches).not.toHaveBeenCalled();
    await act(async () => void (await result.current.run()));
    expect(api.getBranches).toHaveBeenCalledWith(PATH);
  });

  it('useDeployments reads the environment cards on demand', async () => {
    const { result } = renderHook(() => useDeployments(PATH));
    expect(api.getDeployments).not.toHaveBeenCalled();
    await act(async () => void (await result.current.run()));
    expect(api.getDeployments).toHaveBeenCalledWith(PATH);
  });

  it('useWorkflows reads the workflows', async () => {
    const { result } = renderHook(() => useWorkflows(PATH));
    await act(async () => void (await result.current.run()));
    expect(api.getWorkflows).toHaveBeenCalledWith(PATH);
  });

  it('usePackageManifest reads HEAD by default and another ref on request', async () => {
    const wrapper = queryWrapper();
    const head = renderHook(() => usePackageManifest(PATH), { wrapper });
    await waitFor(() => expect(head.result.current.isSuccess).toBe(true));
    expect(api.getPackage).toHaveBeenLastCalledWith(PATH, 'head', undefined);
    renderHook(() => usePackageManifest(PATH, undefined, 'develop'), {
      wrapper,
    });
    await waitFor(() =>
      expect(api.getPackage).toHaveBeenLastCalledWith(
        PATH,
        'develop',
        undefined,
      ),
    );
  });

  it('usePackageManifest reads a workspace once and then uses the cache', async () => {
    const wrapper = queryWrapper();
    const first = renderHook(() => usePackageManifest(PATH, 'apps/web'), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(api.getPackage).toHaveBeenLastCalledWith(PATH, 'head', 'apps/web');
    const second = renderHook(() => usePackageManifest(PATH, 'apps/web'), {
      wrapper,
    });
    expect(second.result.current.isSuccess).toBe(true);
    expect(api.getPackage).toHaveBeenCalledTimes(1);
  });
});
