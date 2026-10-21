import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsyncAction } from './useAsyncAction';

describe('useAsyncAction', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useAsyncAction(async () => 1));
    expect(result.current).toMatchObject({
      status: 'idle',
      data: null,
      error: null,
      isLoading: false,
    });
  });

  it('goes loading then success with the data', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async (n: number) => n * 2),
    );
    let returned: number | undefined;
    await act(async () => {
      returned = await result.current.run(21);
    });
    expect(returned).toBe(42);
    expect(result.current).toMatchObject({
      status: 'success',
      data: 42,
      error: null,
    });
  });

  it('flags loading while the action is pending', async () => {
    let finish!: (value: string) => void;
    const { result } = renderHook(() =>
      useAsyncAction(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    act(() => {
      void result.current.run();
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => finish('done'));
    expect(result.current.isLoading).toBe(false);
  });

  it('captures an error without throwing and keeps the previous data', async () => {
    let fail = false;
    const { result } = renderHook(() =>
      useAsyncAction(async () => {
        if (fail) throw new Error('boom');
        return 'first';
      }),
    );
    await act(async () => void (await result.current.run()));
    fail = true;
    await act(async () => void (await result.current.run()));
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.data).toBe('first');
  });

  it('wraps a non-Error rejection', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(() => Promise.reject('text')),
    );
    await act(async () => void (await result.current.run()));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('text');
  });

  it('keeps only the result of the latest run', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const { result } = renderHook(() =>
      useAsyncAction(
        () => new Promise<string>((resolve) => resolvers.push(resolve)),
      ),
    );
    act(() => {
      void result.current.run();
      void result.current.run();
    });
    await act(async () => resolvers[1]('second'));
    await act(async () => resolvers[0]('first'));
    expect(result.current.data).toBe('second');
  });

  it('resets to idle', async () => {
    const { result } = renderHook(() => useAsyncAction(async () => 'x'));
    await act(async () => void (await result.current.run()));
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.data).toBeNull();
  });

  it('does not update state after unmount', async () => {
    let finish!: (value: string) => void;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() =>
      useAsyncAction(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    act(() => {
      void result.current.run();
    });
    unmount();
    await act(async () => finish('late'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
