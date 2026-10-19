import { act, renderHook } from '@testing-library/react';
import { useClipboard } from './useClipboard';

describe('useClipboard', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies with the clipboard API and flags the copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { result } = renderHook(() => useClipboard());
    let ok = false;
    await act(async () => {
      ok = await result.current.copy('https://app.example.com');
    });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://app.example.com');
    expect(result.current.copied).toBe(true);
  });

  it('resets the copied flag after the delay', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { result } = renderHook(() => useClipboard(1000));
    await act(async () => {
      await result.current.copy('x');
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });

  it('falls back to selection when the clipboard API is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true);
    const { result } = renderHook(() => useClipboard());
    let ok = false;
    await act(async () => {
      ok = await result.current.copy('fallback');
    });
    expect(ok).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports a failure when nothing works', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false);
    const { result } = renderHook(() => useClipboard());
    let ok = true;
    await act(async () => {
      ok = await result.current.copy('nope');
    });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
  });
});
