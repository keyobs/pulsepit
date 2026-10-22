import type { DeploymentCheck, MonitoringResponse } from '@pulsepit/contracts';

export type { DeploymentCheck } from '@pulsepit/contracts';

async function checkUrl(
  environment: string,
  url: string,
  timeoutMs: number,
): Promise<DeploymentCheck> {
  const started = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const base = () => ({
    environment,
    url,
    responseTimeMs: Math.round(performance.now() - started),
    checkedAt: new Date().toISOString(),
  });
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      signal,
      redirect: 'follow',
    });
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel();
      // Reuse the same signal so the fallback does not reset the deadline.
      response = await fetch(url, {
        method: 'GET',
        signal,
        redirect: 'follow',
      });
    }
    await response.body?.cancel();
    const online = response.status >= 200 && response.status < 400;
    return {
      ...base(),
      status: online ? 'online' : 'offline',
      statusCode: response.status,
      errorCode: online ? null : 'HTTP_ERROR',
      error: online ? null : `HTTP check returned status ${response.status}.`,
    };
  } catch {
    return {
      ...base(),
      status: 'offline',
      statusCode: null,
      errorCode: signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      error: signal.aborted
        ? `HTTP check timed out after ${timeoutMs} ms.`
        : 'Unable to reach the configured URL.',
    };
  }
}

export async function checkDeploymentUrls(
  urls: Record<string, string>,
  timeoutMs = 5_000,
): Promise<Omit<MonitoringResponse, 'path'>> {
  const entries = Object.entries(urls).sort(([a], [b]) => a.localeCompare(b));
  const checks: DeploymentCheck[] = new Array(entries.length);
  let next = 0;
  // Bound simultaneous connections while preserving a deterministic order.
  await Promise.all(
    Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (next < entries.length) {
        const index = next++;
        const [environment, url] = entries[index];
        checks[index] = await checkUrl(environment, url, timeoutMs);
      }
    }),
  );
  return { configured: entries.length > 0, checks };
}
