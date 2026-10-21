import { renderHook, waitFor } from '@testing-library/react';
import { useBeaconVersion } from './useBeaconVersion';

const api = vi.hoisted(() => ({ getPackage: vi.fn() }));
vi.mock('@api/repositories.api', () => api);

const PATH = '/home/user/Projets/izeetok';

describe('useBeaconVersion', () => {
  beforeEach(() => api.getPackage.mockReset());

  it('reads the declared version from devDependencies', async () => {
    api.getPackage.mockResolvedValue({
      path: PATH,
      ref: 'head',
      manifest: { devDependencies: { '@keyobs/pulsepit-beacon': '0.1.1' } },
    });
    const { result } = renderHook(() => useBeaconVersion(PATH, true));
    await waitFor(() => expect(result.current.version).toBe('0.1.1'));
  });

  it('prefers dependencies over devDependencies', async () => {
    api.getPackage.mockResolvedValue({
      path: PATH,
      ref: 'head',
      manifest: {
        dependencies: { '@keyobs/pulsepit-beacon': '^0.2.0' },
        devDependencies: { '@keyobs/pulsepit-beacon': '0.1.1' },
      },
    });
    const { result } = renderHook(() => useBeaconVersion(PATH, true));
    await waitFor(() => expect(result.current.version).toBe('^0.2.0'));
  });

  it('does not read the manifest when there is no beacon', () => {
    const { result } = renderHook(() => useBeaconVersion(PATH, false));
    expect(api.getPackage).not.toHaveBeenCalled();
    expect(result.current.version).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
