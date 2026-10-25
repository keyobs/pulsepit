import { ApiError } from '@api/apiError';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRetryDeadline } from './useRetryDeadline';

const NOW = new Date('2026-10-25T10:00:00.000Z');
const RESET_AT = '2026-10-25T10:00:30.000Z';

const rateLimited = (resetAt?: string) =>
  new ApiError('Rate limited', {
    status: 502,
    code: 'REGISTRY_RATE_LIMITED',
    resetAt,
  });

describe('useRetryDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('returns the future deadline then null exactly when it is reached', () => {
    const { result } = renderHook(() =>
      useRetryDeadline(rateLimited(RESET_AT)),
    );
    expect(result.current).toBe(RESET_AT);
    act(() => vi.advanceTimersByTime(29_999));
    expect(result.current).toBe(RESET_AT);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('ignores past deadlines, missing deadlines and other errors', () => {
    const cases: unknown[] = [
      rateLimited('2026-10-25T09:59:59.000Z'),
      rateLimited(),
      new ApiError('Down', {
        status: 502,
        code: 'REGISTRY_UNAVAILABLE',
        resetAt: RESET_AT,
      }),
      new Error('boom'),
      null,
    ];
    for (const error of cases) {
      const { result } = renderHook(() => useRetryDeadline(error));
      expect(result.current).toBeNull();
    }
  });
});
