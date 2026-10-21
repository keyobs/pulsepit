import type { DeploymentMetadataError } from '@pulsepit/contracts';

interface VercelDeploymentOptions {
  commit: string | null;
  url: string | null;
  branch: string | null;
  projectId: string;
  teamId?: string;
  token?: string;
}

interface VercelDeploymentDate {
  deployedAt: string | null;
  error: DeploymentMetadataError | null;
}

class VercelError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new VercelError(
    'VERCEL_INVALID_RESPONSE',
    'Vercel returned invalid deployment data.',
  );
}

function host(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url.hostname;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const maxBytes = 256 * 1024;
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel();
    invalid();
  }
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        invalid();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    invalid();
  }
  if (!object(body)) invalid();
  return body;
}

function aliasDeployment(
  body: Record<string, unknown>,
  hostname: string,
  projectId: string,
): string | null {
  if (
    typeof body.alias !== 'string' ||
    typeof body.deploymentId !== 'string' ||
    typeof body.projectId !== 'string'
  )
    invalid();
  if (!/^dpl_[a-z\d]+$/i.test(body.deploymentId)) invalid();
  if (
    body.alias.toLowerCase() !== hostname ||
    body.projectId !== projectId ||
    body.deletedAt != null ||
    body.redirect ||
    body.microfrontends != null
  )
    return null;
  if (
    body.deployment !== undefined &&
    (!object(body.deployment) || body.deployment.id !== body.deploymentId)
  )
    invalid();
  return body.deploymentId;
}

function matchingCommit(
  meta: unknown,
  expected: string,
  branch: string | null,
): boolean {
  if (!object(meta)) return false;
  let found = false;
  for (const provider of ['github', 'gitlab']) {
    const sha = meta[`${provider}CommitSha`];
    const ref = meta[`${provider}CommitRef`];
    if (sha === undefined) continue;
    if (typeof sha !== 'string' || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha))
      invalid();
    if (sha.toLowerCase() !== expected.toLowerCase()) return false;
    if (branch !== null && ref !== branch) return false;
    found = true;
  }
  return found;
}

export async function getVercelDeploymentDate(
  options: VercelDeploymentOptions,
  timeoutMs = 5_000,
): Promise<VercelDeploymentDate> {
  const empty: VercelDeploymentDate = { deployedAt: null, error: null };
  const hostname = host(options.url);
  if (
    hostname === null ||
    !options.commit ||
    !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(options.commit)
  )
    return empty;
  if (!options.token?.trim())
    return {
      deployedAt: null,
      error: {
        code: 'VERCEL_TOKEN_REQUIRED',
        message:
          'Configure a server-side Vercel access token to read deployment data.',
      },
    };
  const signal = AbortSignal.timeout(timeoutMs);
  async function request(
    path: string,
    alias = false,
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, 'https://api.vercel.com');
    if (options.teamId) url.searchParams.set('teamId', options.teamId);
    if (alias) url.searchParams.set('projectId', options.projectId);
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.token}`,
        'User-Agent': 'pulsepit',
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const errors: Record<number, [string, string]> = {
        401: ['VERCEL_AUTHENTICATION_FAILED', 'Vercel authentication failed.'],
        403: ['VERCEL_FORBIDDEN', 'Vercel denied access to deployment data.'],
        404: [
          'VERCEL_DEPLOYMENT_UNAVAILABLE',
          'Vercel deployment data is unavailable or inaccessible.',
        ],
        429: [
          'VERCEL_RATE_LIMITED',
          'Vercel API rate limit reached. Try again later.',
        ],
      };
      const [code, message] = errors[response.status] ?? [
        'VERCEL_REQUEST_FAILED',
        'Unable to retrieve deployment data from Vercel.',
      ];
      throw new VercelError(code, message);
    }
    const body = await readJson(response);
    if (signal.aborted) throw signal.reason;
    return body;
  }
  try {
    const aliasPath = `/v4/aliases/${encodeURIComponent(hostname)}`;
    const alias = await request(aliasPath, true);
    const id = aliasDeployment(alias, hostname, options.projectId);
    if (id === null) return empty;
    const deployment = await request(
      `/v13/deployments/${encodeURIComponent(id)}`,
    );
    if (
      typeof deployment.id !== 'string' ||
      typeof deployment.projectId !== 'string' ||
      typeof deployment.readyState !== 'string'
    )
      invalid();
    if (
      deployment.id !== id ||
      deployment.projectId !== options.projectId ||
      deployment.readyState !== 'READY' ||
      deployment.target !== 'production' ||
      (deployment.readySubstate !== undefined &&
        deployment.readySubstate !== 'PROMOTED') ||
      !matchingCommit(deployment.meta, options.commit, options.branch)
    )
      return empty;
    if (deployment.ready == null) return empty;
    if (
      !Number.isSafeInteger(deployment.ready) ||
      Number(deployment.ready) <= 0 ||
      Number(deployment.ready) > 253402300799999
    )
      invalid();
    const confirmation = await request(aliasPath, true);
    if (aliasDeployment(confirmation, hostname, options.projectId) !== id)
      return empty;
    return {
      deployedAt: new Date(Number(deployment.ready)).toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      deployedAt: null,
      error: signal.aborted
        ? {
            code: 'TIMEOUT',
            message: 'Reading Vercel deployment data timed out.',
          }
        : error instanceof VercelError
          ? { code: error.code, message: error.message }
          : {
              code: 'VERCEL_REQUEST_FAILED',
              message: 'Unable to reach Vercel.',
            },
    };
  }
}
