import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGithubPagesDeploymentDate } from '../src/services/github-pages-deployment.service.js';

const repository = {
  owner: 'keyobs',
  repo: 'project',
  url: 'https://github.com/keyobs/project',
};
const sha = 'a'.repeat(40);
const options = {
  commit: sha,
  url: 'https://keyobs.github.io/project/',
  environment: 'github-pages',
  branch: 'develop',
};
const deployment = (id = 1) => ({
  id,
  sha,
  ref: 'develop',
  environment: 'github-pages',
  task: 'deploy',
  created_at: '2026-10-21T11:00:00Z',
  statuses_url: 'https://untrusted.example.invalid/secret',
});
const status = (id = 1, created_at = '2026-10-21T13:00:36Z') => ({
  id,
  state: 'success',
  created_at,
  environment: 'github-pages',
  environment_url: options.url,
});

test('Pages dates use matching success confirmations, fixed GitHub endpoints and a shared deadline', async (t) => {
  let signal: AbortSignal | null | undefined;
  const calls: URL[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer server-secret',
      );
      assert.equal(
        new Headers(init?.headers).get('x-github-api-version'),
        '2026-03-10',
      );
      if (signal === undefined) signal = init?.signal;
      else assert.equal(init?.signal, signal);
      if (calls.length === 1) {
        assert.equal(url.searchParams.get('sha'), sha);
        assert.equal(url.searchParams.get('environment'), 'github-pages');
        assert.equal(url.searchParams.get('task'), 'deploy');
        assert.equal(url.searchParams.get('per_page'), '10');
        assert.equal(url.searchParams.get('page'), '1');
        return Response.json([deployment(3), deployment(2), deployment(1)]);
      }
      if (url.pathname.endsWith('/3/statuses'))
        return Response.json([{ ...status(), state: 'failure' }]);
      if (url.pathname.endsWith('/2/statuses'))
        return Response.json([
          status(2, '2026-10-21T12:00:00Z'),
          { ...status(3), environment_url: options.url.slice(0, -1) },
        ]);
      return Response.json([status(1, '2026-10-21T10:00:00Z')]);
    },
  );
  const result = await getGithubPagesDeploymentDate(repository, {
    ...options,
    token: 'server-secret',
  });
  assert.deepEqual(result, {
    deployedAt: '2026-10-21T13:00:36.000Z',
    error: null,
  });
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(result).includes('server-secret'), false);
});

test('Pages correlation excludes other commits, branches, tasks, environments, URLs and inactive deployments', async (t) => {
  let count = 0;
  const mocked = t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      const path = new URL(String(input)).pathname;
      count++;
      if (path.endsWith('/deployments'))
        return Response.json([
          { ...deployment(1), sha: 'b'.repeat(40) },
          { ...deployment(2), ref: 'main' },
          { ...deployment(3), task: 'deploy:migrations' },
          { ...deployment(4), environment: 'production' },
          deployment(5),
          deployment(6),
          deployment(7),
          deployment(8),
          deployment(9),
          deployment(10),
        ]);
      const id = Number(path.split('/').at(-2));
      if (id === 5)
        return Response.json([
          status(1),
          { ...status(2, '2026-10-21T14:00:00Z'), state: 'inactive' },
        ]);
      const wrong = {
        6: 'https://keyobs.github.io/other/',
        7: 'http://keyobs.github.io/project/',
        8: 'https://keyobs.github.io/project/?preview=1',
        9: 'https://keyobs.github.io/project/#preview',
        10: 'https://user:password@keyobs.github.io/project/',
      }[id];
      return Response.json([{ ...status(), environment_url: wrong }]);
    },
  );
  assert.deepEqual(await getGithubPagesDeploymentDate(repository, options), {
    deployedAt: null,
    error: null,
  });
  assert.equal(count, 7);
  mocked.mock.mockImplementation(async () => Response.json([]));
  assert.deepEqual(await getGithubPagesDeploymentDate(repository, options), {
    deployedAt: null,
    error: null,
  });
});

test('Pages makes no request without a complete served commit, target URL or provider environment', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected request.');
  });
  for (const overrides of [
    { commit: null },
    { commit: 'short' },
    { url: null },
    { url: 'ftp://example.invalid' },
    { environment: ' ' },
  ]) {
    assert.deepEqual(
      await getGithubPagesDeploymentDate(repository, {
        ...options,
        ...overrides,
      }),
      {
        deployedAt: null,
        error: null,
      },
    );
  }
  assert.equal(mocked.mock.calls.length, 0);
});

test('Pages sanitizes API errors, authentication failures and rate limits at either request stage', async (t) => {
  let response = () => Response.json([], { status: 200 });
  let failStatuses = false;
  t.mock.method(globalThis, 'fetch', async (input: unknown) =>
    failStatuses && new URL(String(input)).pathname.endsWith('/deployments')
      ? Response.json([deployment()])
      : response(),
  );
  for (const secondStage of [false, true]) {
    failStatuses = secondStage;
    for (const [http, headers, code] of [
      [401, {}, 'GITHUB_AUTHENTICATION_FAILED'],
      [403, {}, 'GITHUB_FORBIDDEN'],
      [404, {}, 'GITHUB_REPOSITORY_UNAVAILABLE'],
      [429, {}, 'GITHUB_RATE_LIMITED'],
      [403, { 'x-ratelimit-remaining': '0' }, 'GITHUB_RATE_LIMITED'],
      [403, { 'retry-after': '60' }, 'GITHUB_RATE_LIMITED'],
      [503, {}, 'GITHUB_REQUEST_FAILED'],
    ] as const) {
      response = () =>
        new Response('secret-upstream-body', { status: http, headers });
      const result = await getGithubPagesDeploymentDate(repository, options);
      assert.equal(result.deployedAt, null);
      assert.equal(result.error?.code, code);
      assert.equal(JSON.stringify(result).includes('secret'), false);
    }
  }
  response = () => {
    throw new Error('secret-exception');
  };
  const result = await getGithubPagesDeploymentDate(repository, options);
  assert.equal(result.error?.code, 'GITHUB_REQUEST_FAILED');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Pages rejects malformed documents and impossible dates rather than inventing a deployment date', async (t) => {
  let deploymentBody: unknown = [deployment()];
  let statusBody: unknown = [status()];
  t.mock.method(globalThis, 'fetch', async (input: unknown) =>
    Response.json(
      new URL(String(input)).pathname.endsWith('/deployments')
        ? deploymentBody
        : statusBody,
    ),
  );
  for (const bad of [
    {},
    [null],
    [{ ...deployment(), id: '../escape' }],
    [{ ...deployment(), sha: null }],
    Array.from({ length: 11 }, () => deployment()),
  ]) {
    deploymentBody = bad;
    const result = await getGithubPagesDeploymentDate(repository, options);
    assert.equal(result.deployedAt, null);
    assert.equal(result.error?.code, 'GITHUB_INVALID_RESPONSE');
  }
  deploymentBody = [deployment()];
  for (const bad of [
    {},
    [null],
    [{ ...status(), created_at: '2026-02-30T12:00:00Z' }],
    [{ ...status(), state: null }],
  ]) {
    statusBody = bad;
    const result = await getGithubPagesDeploymentDate(repository, options);
    assert.equal(result.deployedAt, null);
    assert.equal(result.error?.code, 'GITHUB_INVALID_RESPONSE');
  }
});

test('Pages limits announced and actual response size and aborts stalled response bodies', async (t) => {
  let factory = (_init?: RequestInit): Response =>
    new Response(`[]${' '.repeat(256 * 1024)}`);
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: unknown, init?: RequestInit) => factory(init),
  );
  assert.equal(
    (await getGithubPagesDeploymentDate(repository, options)).error?.code,
    'GITHUB_INVALID_RESPONSE',
  );
  factory = () =>
    new Response('[]', {
      headers: { 'content-length': String(256 * 1024 + 1) },
    });
  assert.equal(
    (await getGithubPagesDeploymentDate(repository, options)).error?.code,
    'GITHUB_INVALID_RESPONSE',
  );
  factory = () => new Response('<html>Not JSON</html>');
  assert.equal(
    (await getGithubPagesDeploymentDate(repository, options)).error?.code,
    'GITHUB_INVALID_RESPONSE',
  );
  factory = (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const timer = setTimeout(
            () => controller.error(new Error('Abort not received.')),
            1000,
          );
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              controller.error(init.signal?.reason);
            },
            { once: true },
          );
        },
      }),
    );
  const result = await getGithubPagesDeploymentDate(repository, options, 20);
  assert.equal(result.deployedAt, null);
  assert.equal(result.error?.code, 'TIMEOUT');
});

test('Pages bounds request count, ignores pagination links and supports optional branch matching', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    calls++;
    if (new URL(String(input)).pathname.endsWith('/deployments'))
      return Response.json(
        Array.from({ length: 10 }, (_, i) => ({
          ...deployment(i + 1),
          ref: 'manual-ref',
        })),
        {
          headers: {
            link: '<https://untrusted.example.invalid/next>; rel="next"',
          },
        },
      );
    return Response.json([status()]);
  });
  const result = await getGithubPagesDeploymentDate(repository, {
    ...options,
    branch: null,
  });
  assert.equal(result.deployedAt, '2026-10-21T13:00:36.000Z');
  assert.equal(result.error, null);
  assert.equal(calls, 11);
});
