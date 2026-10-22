import {
  DeploymentEnvironment,
  type DeploymentMetadataError,
} from '@pulsepit/contracts';
import type { GithubRepositoryIdentity } from '../git/git-origin.service.js';

interface PagesDeploymentOptions {
  commit: string | null;
  url: string | null;
  environment: string;
  branch: string | null;
  token?: string;
}

interface PagesDeploymentDate {
  deployedAt: string | null;
  error: DeploymentMetadataError | null;
}

class GithubPagesError extends Error {
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
  throw new GithubPagesError(
    'GITHUB_INVALID_RESPONSE',
    'GitHub returned invalid deployment data.',
  );
}

function applicationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !DeploymentEnvironment.shape.deployedAt.safeParse(value).success
  )
    invalid();
  return new Date(value).toISOString();
}

async function readJson(response: Response): Promise<unknown> {
  const maxBytes = 256 * 1024;
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maxBytes) {
    await response.body?.cancel();
    invalid();
  }
  if (!response.body) invalid();
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    invalid();
  }
}

export async function getGithubPagesDeploymentDate(
  repository: GithubRepositoryIdentity,
  options: PagesDeploymentOptions,
  timeoutMs = 5_000,
): Promise<PagesDeploymentDate> {
  const empty: PagesDeploymentDate = { deployedAt: null, error: null };
  const expectedUrl = applicationUrl(options.url);
  if (
    !options.commit ||
    !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(options.commit) ||
    expectedUrl === null ||
    !options.environment.trim()
  )
    return empty;

  const signal = AbortSignal.timeout(timeoutMs);
  const base = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/deployments`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'pulsepit',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };
  async function request(url: URL): Promise<unknown[]> {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers,
    });
    if (!response.ok) {
      await response.body?.cancel();
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' ||
            response.headers.has('retry-after')));
      if (rateLimited)
        throw new GithubPagesError(
          'GITHUB_RATE_LIMITED',
          'GitHub API rate limit reached. Try again later.',
        );
      const errors: Record<number, [string, string]> = {
        401: ['GITHUB_AUTHENTICATION_FAILED', 'GitHub authentication failed.'],
        403: ['GITHUB_FORBIDDEN', 'GitHub denied access to deployment data.'],
        404: [
          'GITHUB_REPOSITORY_UNAVAILABLE',
          'GitHub deployment data is unavailable or inaccessible.',
        ],
      };
      const [code, message] = errors[response.status] ?? [
        'GITHUB_REQUEST_FAILED',
        'Unable to retrieve deployment data from GitHub.',
      ];
      throw new GithubPagesError(code, message);
    }
    const body = await readJson(response);
    if (signal.aborted) throw signal.reason;
    if (!Array.isArray(body) || body.length > 10) invalid();
    return body;
  }

  try {
    const url = new URL(base);
    url.search = new URLSearchParams({
      sha: options.commit,
      environment: options.environment,
      task: 'deploy',
      per_page: '10',
      page: '1',
    }).toString();
    const deployments = await request(url);
    let deployedAt: string | null = null;
    for (const deployment of deployments) {
      if (
        !object(deployment) ||
        !Number.isSafeInteger(deployment.id) ||
        Number(deployment.id) <= 0 ||
        typeof deployment.sha !== 'string' ||
        typeof deployment.environment !== 'string' ||
        typeof deployment.ref !== 'string' ||
        typeof deployment.task !== 'string'
      )
        invalid();
      if (
        deployment.sha.toLowerCase() !== options.commit.toLowerCase() ||
        deployment.environment !== options.environment ||
        deployment.task !== 'deploy' ||
        (options.branch !== null && deployment.ref !== options.branch)
      )
        continue;

      // Construct the trusted endpoint instead of following statuses_url.
      const statusUrl = new URL(`${base}/${deployment.id}/statuses`);
      statusUrl.search = 'per_page=10&page=1';
      const statuses = await request(statusUrl);
      const parsed = statuses.map((status) => {
        if (
          !object(status) ||
          !Number.isSafeInteger(status.id) ||
          Number(status.id) <= 0 ||
          typeof status.state !== 'string' ||
          typeof status.environment !== 'string' ||
          typeof status.environment_url !== 'string'
        )
          invalid();
        return {
          id: Number(status.id),
          state: status.state,
          environment: status.environment,
          environmentUrl: status.environment_url,
          createdAt: date(status.created_at),
        };
      });
      parsed.sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id),
      );
      const latest = parsed[0];
      if (
        latest?.state !== 'success' ||
        latest.environment !== options.environment ||
        applicationUrl(latest.environmentUrl) !== expectedUrl
      )
        continue;
      if (deployedAt === null || latest.createdAt > deployedAt) {
        deployedAt = latest.createdAt;
      }
    }
    return { deployedAt, error: null };
  } catch (error) {
    return {
      deployedAt: null,
      error: signal.aborted
        ? {
            code: 'TIMEOUT',
            message: 'Reading GitHub deployment data timed out.',
          }
        : error instanceof GithubPagesError
          ? { code: error.code, message: error.message }
          : {
              code: 'GITHUB_REQUEST_FAILED',
              message: 'Unable to reach GitHub.',
            },
    };
  }
}
