/** File d'attente qui exécute au plus `limit` tâches asynchrones à la fois, dans l'ordre d'arrivée. */
export function createRequestQueue(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  const startNext = () => {
    while (active < limit && waiting.length > 0) {
      active += 1;
      waiting.shift()?.();
    }
  };

  const enqueue = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            startNext();
          });
      });
      startNext();
    });

  return { enqueue };
}
