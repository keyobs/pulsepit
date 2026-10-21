import { act, renderHook } from '@testing-library/react';
import { useBranches } from './useBranches';
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
}));
vi.mock('@api/repositories.api', () => api);

const PATH = '/home/user/Projets/mon-app';

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

  it('useWorkflows reads the workflows', async () => {
    const { result } = renderHook(() => useWorkflows(PATH));
    await act(async () => void (await result.current.run()));
    expect(api.getWorkflows).toHaveBeenCalledWith(PATH);
  });

  it('usePackageManifest reads HEAD by default and another ref on request', async () => {
    const { result } = renderHook(() => usePackageManifest(PATH));
    await act(async () => void (await result.current.run()));
    expect(api.getPackage).toHaveBeenLastCalledWith(PATH, 'head');
    await act(async () => void (await result.current.run('develop')));
    expect(api.getPackage).toHaveBeenLastCalledWith(PATH, 'develop');
  });
});
