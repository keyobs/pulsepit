import { createQueryClient } from '@api/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useBeaconVersion } from './useBeaconVersion';

const api = vi.hoisted(() => ({ getPackage: vi.fn() }));
vi.mock('@api/repositories.api', () => api);

const PATH = '/home/user/Projets/izeetok';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: createQueryClient() }, children);

describe('useBeaconVersion', () => {
  beforeEach(() => api.getPackage.mockReset());

  it('reads the declared version from devDependencies', async () => {
    api.getPackage.mockResolvedValue({
      path: PATH,
      ref: 'head',
      manifest: { devDependencies: { '@keyobs/pulsepit-beacon': '0.1.1' } },
    });
    const { result } = renderHook(() => useBeaconVersion(PATH, true), {
      wrapper,
    });
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
    const { result } = renderHook(() => useBeaconVersion(PATH, true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.version).toBe('^0.2.0'));
  });

  it('does not read the manifest when there is no beacon', () => {
    const { result } = renderHook(() => useBeaconVersion(PATH, false), {
      wrapper,
    });
    expect(api.getPackage).not.toHaveBeenCalled();
    expect(result.current.version).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
