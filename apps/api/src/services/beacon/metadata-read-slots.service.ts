// Shared by periodic monitoring and all on-demand metadata collections.
let active = 0;
const waiting: Array<() => void> = [];

export async function acquireMetadataReadSlot(signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (active < 4) active++;
  else {
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(ready);
        if (index !== -1) waiting.splice(index, 1);
        reject(signal?.reason);
      };
      waiting.push(ready);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  return () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
}
