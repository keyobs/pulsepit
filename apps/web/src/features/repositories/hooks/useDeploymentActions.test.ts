import { act, renderHook } from '@testing-library/react';
import { useDeploymentActions } from './useDeploymentActions';

const api = vi.hoisted(() => ({ checkDeployments: vi.fn() }));
vi.mock('@api/repositories.api', () => api);
vi.mock('@hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const PATH = '/home/user/Projets/mon-app';

const check = (
  environment: string,
  status: 'online' | 'offline',
  at: string,
) => ({
  environment,
  url: `https://${environment}.example.com`,
  status,
  statusCode: status === 'online' ? 200 : null,
  responseTimeMs: 12,
  checkedAt: at,
  errorCode: null,
  error: null,
});

const response = (...checks: ReturnType<typeof check>[]) => ({
  path: PATH,
  configured: true,
  checks,
});

describe('useDeploymentActions', () => {
  beforeEach(() => api.checkDeployments.mockReset());

  it('pings one environment and keeps the others untouched', async () => {
    api.checkDeployments.mockResolvedValue(
      response(check('staging', 'online', '2026-10-21T10:00:00.000Z')),
    );
    const { result } = renderHook(() => useDeploymentActions());
    expect(result.current.monitoringOf(PATH)).toBeNull();

    await act(async () => void (await result.current.ping(PATH, 'staging')));

    expect(api.checkDeployments).toHaveBeenCalledWith(PATH, 'staging');
    expect(result.current.monitoringOf(PATH)?.checks).toHaveLength(1);
    expect(result.current.pingStateOf(PATH, 'staging').status).toBe('success');
    expect(result.current.pingStateOf(PATH, 'production').status).toBe('idle');
  });

  it('merges a targeted ping into a full check and keeps the most recent result', async () => {
    api.checkDeployments
      .mockResolvedValueOnce(
        response(
          check('production', 'online', '2026-10-21T10:00:00.000Z'),
          check('staging', 'online', '2026-10-21T10:00:00.000Z'),
        ),
      )
      .mockResolvedValueOnce(
        response(check('staging', 'offline', '2026-10-21T10:05:00.000Z')),
      );
    const { result } = renderHook(() => useDeploymentActions());

    await act(async () => void (await result.current.run(PATH)));
    await act(async () => void (await result.current.ping(PATH, 'staging')));

    const checks = result.current.monitoringOf(PATH)?.checks ?? [];
    expect(checks.find((item) => item.environment === 'staging')?.status).toBe(
      'offline',
    );
    expect(
      checks.find((item) => item.environment === 'production')?.status,
    ).toBe('online');
  });
});
