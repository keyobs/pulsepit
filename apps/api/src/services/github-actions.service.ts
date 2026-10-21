import {
  type ErrorResponse,
  GithubActionsRun,
  type GithubActionsRunsResponse,
} from '@pulsepit/contracts';
import type { GithubRepositoryIdentity } from './git-origin.service.js';

type RunsData = Pick<
  GithubActionsRunsResponse,
  'runs' | 'rateLimit' | 'checkedAt'
>;
type RunsResult =
  | { ok: true; data: RunsData }
  | { ok: false; statusCode: number; error: ErrorResponse };

function failure(
  statusCode: number,
  code: string,
  error: string,
  resetAt?: string,
): RunsResult {
  return {
    ok: false,
    statusCode,
    error: { code, error, ...(resetAt === undefined ? {} : { resetAt }) },
  };
}

function integerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function resetDate(headers: Headers): string | undefined {
  const seconds = integerHeader(headers, 'x-ratelimit-reset');
  if (seconds === null) return undefined;
  const date = new Date(seconds * 1_000);
  // Keep the same four-digit UTC year format as the public datetime schema.
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999)
    return undefined;
  return date.toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getGithubActionsRuns(
  repository: GithubRepositoryIdentity,
  options: { branch?: string; limit: number; token?: string },
  timeoutMs = 10_000,
): Promise<RunsResult> {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions/runs`,
  );
  url.searchParams.set('per_page', String(options.limit));
  url.searchParams.set('page', '1');
  if (options.branch !== undefined)
    url.searchParams.set('branch', options.branch);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'pulsepit',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    });
    const checkedAt = new Date().toISOString();
    const remaining = integerHeader(response.headers, 'x-ratelimit-remaining');
    const resetAt = resetDate(response.headers);
    if (!response.ok) {
      let secondaryRateLimit = false;
      if (response.status === 403) {
        const body: unknown = await response.json().catch(() => null);
        secondaryRateLimit =
          isObject(body) &&
          typeof body.message === 'string' &&
          /secondary rate limit|abuse detection/i.test(body.message);
      } else {
        await response.body?.cancel();
      }
      if (signal.aborted) throw signal.reason;
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (remaining === 0 ||
            response.headers.has('retry-after') ||
            secondaryRateLimit))
      ) {
        return failure(
          503,
          'GITHUB_RATE_LIMITED',
          'GitHub API rate limit reached. Try again later.',
          resetAt,
        );
      }
      const knownErrors: Record<number, [string, string]> = {
        401: ['GITHUB_AUTHENTICATION_FAILED', 'GitHub authentication failed.'],
        403: ['GITHUB_FORBIDDEN', 'GitHub denied access to this repository.'],
        404: [
          'GITHUB_REPOSITORY_UNAVAILABLE',
          'The GitHub repository does not exist or is not accessible.',
        ],
      };
      const [code, message] = knownErrors[response.status] ?? [
        'GITHUB_REQUEST_FAILED',
        'Unable to retrieve workflow runs from GitHub.',
      ];
      return failure(502, code, message);
    }

    const invalid = () =>
      failure(
        502,
        'GITHUB_INVALID_RESPONSE',
        'GitHub returned invalid workflow runs.',
      );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) throw signal.reason;
      return invalid();
    }
    if (!isObject(body) || !Array.isArray(body.workflow_runs)) return invalid();
    const runs: GithubActionsRun[] = [];
    for (const run of body.workflow_runs.slice(0, options.limit)) {
      if (!isObject(run)) return invalid();
      const parsed = GithubActionsRun.safeParse({
        id: run.id,
        workflowId: run.workflow_id,
        name: run.name ?? null,
        title: run.display_title,
        url: run.html_url,
        branch: run.head_branch ?? null,
        headSha: run.head_sha,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
      });
      if (!parsed.success) return invalid();
      runs.push(parsed.data);
    }
    return {
      ok: true,
      data: {
        runs,
        checkedAt,
        rateLimit:
          remaining !== null && resetAt !== undefined
            ? { remaining, resetAt }
            : null,
      },
    };
  } catch {
    // Never forward upstream bodies or exception messages, which may contain secrets.
    return signal.aborted
      ? failure(504, 'TIMEOUT', 'GitHub request timed out.')
      : failure(502, 'GITHUB_REQUEST_FAILED', 'Unable to reach GitHub.');
  }
}
