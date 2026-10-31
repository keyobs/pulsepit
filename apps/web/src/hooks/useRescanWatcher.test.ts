import { RESCAN_WATCH_MS } from '@constants/settings';
import { jsonResponse } from '@test/fixtures';
import { act, renderHook } from '@testing-library/react';
import { useRescanWatcher } from './useRescanWatcher';

const settingsResponse = (lastFinishedAt: string | null) =>
  jsonResponse({
    settings: {
      scanPaths: null,
      rescan: { enabled: true, interval: '15m' },
      pushLocks: { all: false, branches: [], repositories: {} },
    },
    effectiveScanPaths: ['/home/user/Projets'],
    scanPathsSource: 'env',
    rescan: { lastStartedAt: null, lastFinishedAt, failures: [] },
  });

describe('useRescanWatcher', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires only when a new scheduled fetch has finished', async () => {
    const onCycle = vi.fn();
    fetchMock
      .mockResolvedValueOnce(settingsResponse('2026-10-31T08:00:00.000Z'))
      .mockResolvedValueOnce(settingsResponse('2026-10-31T08:00:00.000Z'))
      .mockResolvedValueOnce(settingsResponse('2026-10-31T09:00:00.000Z'));
    renderHook(() => useRescanWatcher(onCycle));

    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(RESCAN_WATCH_MS));
    expect(onCycle).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(RESCAN_WATCH_MS));
    expect(onCycle).toHaveBeenCalledTimes(1);
  });
});
