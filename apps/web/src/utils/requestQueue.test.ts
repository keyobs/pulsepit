import { createRequestQueue } from './requestQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createRequestQueue', () => {
  it('never runs more tasks than the limit at once', async () => {
    const queue = createRequestQueue(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const results = gates.map((gate) =>
      queue.enqueue(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );
    for (const gate of gates) {
      await Promise.resolve();
      gate.resolve();
      await Promise.resolve();
    }
    await Promise.all(results);
    expect(peak).toBe(2);
  });

  it('starts waiting tasks in arrival order', async () => {
    const queue = createRequestQueue(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) => queue.enqueue(async () => void order.push(n))),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('resolves with the task result and keeps going after a failure', async () => {
    const queue = createRequestQueue(1);
    const failing = queue.enqueue(() => Promise.reject(new Error('boom')));
    const next = queue.enqueue(() => Promise.resolve('ok'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
