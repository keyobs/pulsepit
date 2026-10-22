import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ErrorResponse, GithubActionsRunsResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { getGithubActionsRuns } from '../src/services/host-provider/github-actions.service.js';

const execute = promisify(execFile);
const identity = {
  owner: 'zeebha',
  repo: 'project',
  url: 'https://github.com/zeebha/project',
};
const resetSeconds = 1_800_000_000;
const resetAt = new Date(resetSeconds * 1_000).toISOString();
const upstreamRun = {
  id: 123,
  workflow_id: 456,
  name: 'CI',
  display_title: 'Check changes',
  html_url: `${identity.url}/actions/runs/123`,
  head_branch: 'feature/contracts',
  head_sha: 'abc123',
  event: 'push',
  status: 'in_progress',
  conclusion: null,
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:01:00Z',
};
const runsUrl = (path: string, params: Record<string, string> = {}) =>
  `/api/repositories/github/actions/runs?${new URLSearchParams({ path, ...params })}`;

async function fixture(t: TestContext, token?: string) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-github-actions-'));
  const path = join(root, 'project');
  const app = buildApp({ port: 3001, scanPaths: [root], githubToken: token });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path);
  const git = (...args: string[]) => execute('git', args, { cwd: path });
  await git('init', '--initial-branch=main');
  await git('remote', 'add', 'origin', 'git@github.com:zeebha/project.git');
  return { root, path, app, git };
}

test('GitHub Actions route maps runs, quota and explicit branch without exposing the server token', async (t) => {
  const token = 'server-only-test-token';
  const { path, app } = await fixture(t, token);
  const mocked = t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(url.pathname, '/repos/zeebha/project/actions/runs');
      assert.equal(url.searchParams.get('branch'), 'feature/contracts');
      assert.equal(url.searchParams.get('per_page'), '1');
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Bearer ${token}`,
      );
      return Response.json(
        { workflow_runs: [upstreamRun] },
        {
          headers: {
            'x-ratelimit-remaining': '59',
            'x-ratelimit-reset': String(resetSeconds),
          },
        },
      );
    },
  );
  const response = await app.inject({
    method: 'GET',
    url: runsUrl(`${path}/.`, { branch: 'feature/contracts', limit: '1' }),
  });
  assert.equal(response.statusCode, 200);
  const parsed = GithubActionsRunsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  assert.deepEqual(parsed.repository, identity);
  assert.equal(parsed.branch, 'feature/contracts');
  assert.equal(parsed.limit, 1);
  assert.equal(new Date(parsed.checkedAt).toISOString(), parsed.checkedAt);
  assert.deepEqual(parsed.rateLimit, { remaining: 59, resetAt });
  assert.deepEqual(parsed.runs, [
    {
      id: 123,
      workflowId: 456,
      name: 'CI',
      title: 'Check changes',
      url: upstreamRun.html_url,
      branch: 'feature/contracts',
      headSha: 'abc123',
      event: 'push',
      status: 'in_progress',
      conclusion: null,
      createdAt: upstreamRun.created_at,
      updatedAt: upstreamRun.updated_at,
    },
  ]);
  assert.equal(response.body.includes(token), false);
  assert.equal(mocked.mock.calls.length, 1);
});

test('GitHub Actions route defaults to all branches and handles empty results and nullable quota', async (t) => {
  const { path, app } = await fixture(t);
  let runs: unknown[] = [];
  let headers: Record<string, string> = {};
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.has('branch'), false);
      assert.equal(url.searchParams.get('per_page'), '10');
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return Response.json({ workflow_runs: runs }, { headers });
    },
  );
  const read = async () => {
    const response = await app.inject({ method: 'GET', url: runsUrl(path) });
    assert.equal(response.statusCode, 200);
    return GithubActionsRunsResponse.parse(response.json());
  };
  const empty = await read();
  assert.deepEqual(empty.runs, []);
  assert.equal(empty.branch, null);
  assert.equal(empty.limit, 10);
  assert.equal(empty.rateLimit, null);
  runs = [
    {
      ...upstreamRun,
      name: undefined,
      head_branch: undefined,
      status: 'future_status',
      conclusion: 'future_conclusion',
    },
  ];
  for (const invalid of [
    {
      'x-ratelimit-remaining': '-1',
      'x-ratelimit-reset': String(resetSeconds),
    },
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'not-a-date' },
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '999999999999999' },
  ]) {
    headers = invalid;
    const parsed = await read();
    assert.equal(parsed.rateLimit, null);
    assert.equal(parsed.runs[0].name, null);
    assert.equal(parsed.runs[0].branch, null);
    assert.equal(parsed.runs[0].status, 'future_status');
    assert.equal(parsed.runs[0].conclusion, 'future_conclusion');
  }
});

test('GitHub Actions validation and origin failures do not contact GitHub', async (t) => {
  const { root, path, app, git } = await fixture(t);
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network access.');
  });
  for (const [url, status] of [
    ['/api/repositories/github/actions/runs', 400],
    [runsUrl('   '), 400],
    [runsUrl(path, { branch: '' }), 400],
    [runsUrl(path, { limit: '0' }), 400],
    [runsUrl(path, { limit: '31' }), 400],
    [runsUrl(path, { limit: '1.5' }), 400],
    [runsUrl(root), 404],
  ] as const) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, status);
    assert.ok(ErrorResponse.parse(response.json()).error);
  }
  for (const origin of ['https://gitlab.com/zeebha/project.git', null]) {
    if (origin) await git('remote', 'set-url', 'origin', origin);
    else await git('remote', 'remove', 'origin');
    const response = await app.inject({ method: 'GET', url: runsUrl(path) });
    assert.equal(response.statusCode, 422);
    assert.equal(
      ErrorResponse.parse(response.json()).code,
      'GITHUB_ORIGIN_REQUIRED',
    );
  }
  await rm(join(path, '.git'), { recursive: true });
  await mkdir(join(path, '.git'));
  const response = await app.inject({ method: 'GET', url: runsUrl(path) });
  assert.equal(response.statusCode, 502);
  assert.equal(ErrorResponse.parse(response.json()).code, 'ORIGIN_READ_FAILED');
  assert.equal(mocked.mock.calls.length, 0);
});

test('GitHub Actions maps upstream failures and preserves resetAt through the shared error schema', async (t) => {
  const { path, app } = await fixture(t);
  let reply: () => Response = () => new Response(null, { status: 500 });
  const mocked = t.mock.method(globalThis, 'fetch', async () => reply());
  const quota = {
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': String(resetSeconds),
  };
  const cases = [
    [
      () => new Response(null, { status: 401 }),
      502,
      'GITHUB_AUTHENTICATION_FAILED',
    ],
    [() => Response.json({}, { status: 403 }), 502, 'GITHUB_FORBIDDEN'],
    [
      () => new Response(null, { status: 404 }),
      502,
      'GITHUB_REPOSITORY_UNAVAILABLE',
    ],
    [() => new Response(null, { status: 500 }), 502, 'GITHUB_REQUEST_FAILED'],
    [
      () => Response.json({}, { status: 403, headers: quota }),
      503,
      'GITHUB_RATE_LIMITED',
      resetAt,
    ],
    [
      () => new Response(null, { status: 429, headers: quota }),
      503,
      'GITHUB_RATE_LIMITED',
      resetAt,
    ],
    [
      () =>
        Response.json(
          { message: 'You have exceeded a secondary rate limit.' },
          { status: 403 },
        ),
      503,
      'GITHUB_RATE_LIMITED',
    ],
    [
      () =>
        Response.json({}, { status: 403, headers: { 'retry-after': '60' } }),
      503,
      'GITHUB_RATE_LIMITED',
    ],
    [() => new Response('invalid JSON'), 502, 'GITHUB_INVALID_RESPONSE'],
    [() => Response.json({}), 502, 'GITHUB_INVALID_RESPONSE'],
    [
      () =>
        Response.json({ workflow_runs: [{ ...upstreamRun, id: 'invalid' }] }),
      502,
      'GITHUB_INVALID_RESPONSE',
    ],
    [
      () => {
        throw new Error('Do not expose secret-token');
      },
      502,
      'GITHUB_REQUEST_FAILED',
    ],
  ] as const;
  for (const [factory, status, code, expectedResetAt] of cases) {
    reply = factory;
    const response = await app.inject({ method: 'GET', url: runsUrl(path) });
    assert.equal(response.statusCode, status);
    const parsed = ErrorResponse.parse(response.json());
    assert.equal(parsed.code, code);
    assert.equal(parsed.resetAt, expectedResetAt);
    assert.equal(parsed.resetAt, response.json().resetAt);
    assert.equal(response.body.includes('secret-token'), false);
    assert.equal(
      GithubActionsRunsResponse.safeParse(response.json()).success,
      false,
    );
  }
  // One upstream request per user request: no retry or pagination.
  assert.equal(mocked.mock.calls.length, cases.length);
});

test('GitHub Actions deadline aborts the transport and token configuration remains optional', async (t) => {
  assert.equal(
    readConfig({ SCAN_PATH: '/tmp', GITHUB_TOKEN: ' server-token ' })
      .githubToken,
    'server-token',
  );
  assert.equal(
    readConfig({ SCAN_PATH: '/tmp', GITHUB_TOKEN: ' ' }).githubToken,
    undefined,
  );
  t.mock.method(
    globalThis,
    'fetch',
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Keep the event loop alive while AbortSignal.timeout's unref'ed timer runs.
        const timer = setTimeout(
          () => reject(new Error('Abort was not received.')),
          1_000,
        );
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      }),
  );
  const result = await getGithubActionsRuns(identity, { limit: 1 }, 20);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('Expected timeout.');
  assert.equal(result.statusCode, 504);
  assert.equal(ErrorResponse.parse(result.error).code, 'TIMEOUT');
});
