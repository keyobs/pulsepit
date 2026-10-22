import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getVercelDeploymentDate } from '../src/services/host-provider/vercel-deployment.service.js';

const sha = 'a'.repeat(40);
const ready = Date.parse('2026-10-21T13:00:36Z');
const options = {
  commit: sha,
  url: 'https://app.example.invalid/',
  branch: 'main',
  projectId: 'prj_project',
  teamId: 'team_project',
  token: 'server-secret',
};
const alias = () => ({
  alias: 'app.example.invalid',
  projectId: options.projectId,
  deploymentId: 'dpl_current',
  deployment: {
    id: 'dpl_current',
    url: 'https://untrusted.example.invalid/path',
  },
  createdAt: ready - 1_000_000,
  updatedAt: ready + 5_000,
});
const deployment = () => ({
  id: 'dpl_current',
  projectId: options.projectId,
  readyState: 'READY',
  readySubstate: 'PROMOTED',
  target: 'production',
  ready,
  createdAt: ready - 100_000,
  meta: { githubCommitSha: sha, githubCommitRef: 'main' },
  env: ['PRIVATE_VALUE=secret-upstream-value'],
});

test('Vercel resolves the current alias and checks it again, returning readiness rather than creation or alias update dates', async (t) => {
  let signal: AbortSignal | null | undefined;
  const calls: URL[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url);
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(url.searchParams.get('teamId'), options.teamId);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer server-secret',
      );
      if (signal === undefined) signal = init?.signal;
      else assert.equal(init?.signal, signal);
      if (calls.length !== 2) {
        assert.equal(url.pathname, '/v4/aliases/app.example.invalid');
        assert.equal(url.searchParams.get('projectId'), options.projectId);
        return Response.json(alias());
      }
      assert.equal(url.pathname, '/v13/deployments/dpl_current');
      return Response.json(deployment());
    },
  );
  const result = await getVercelDeploymentDate(options);
  assert.deepEqual(result, {
    deployedAt: '2026-10-21T13:00:36.000Z',
    error: null,
  });
  assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Vercel supports GitLab and optional branch/team configuration independently of GitHub origin', async (t) => {
  const observed = {
    ...deployment(),
    meta: { gitlabCommitSha: sha.toUpperCase(), gitlabCommitRef: 'develop' },
  };
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.has('teamId'), false);
    return Response.json(
      url.pathname.includes('/aliases/') ? alias() : observed,
    );
  });
  const result = await getVercelDeploymentDate({
    ...options,
    teamId: undefined,
    branch: null,
  });
  assert.equal(result.deployedAt, '2026-10-21T13:00:36.000Z');
  assert.equal(result.error, null);
});

test('Vercel makes no request without served evidence, a supported URL or an access token', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected request.');
  });
  for (const overrides of [
    { commit: null },
    { commit: 'short' },
    { url: null },
    { url: 'http://app.example.invalid/' },
    { url: 'https://app.example.invalid/subpath/' },
    { url: 'https://app.example.invalid/?preview=1' },
    { url: 'https://user:password@app.example.invalid/' },
  ])
    assert.deepEqual(
      await getVercelDeploymentDate({ ...options, ...overrides }),
      { deployedAt: null, error: null },
    );
  for (const token of [undefined, ' ']) {
    const result = await getVercelDeploymentDate({ ...options, token });
    assert.equal(result.deployedAt, null);
    assert.equal(result.error?.code, 'VERCEL_TOKEN_REQUIRED');
  }
  assert.equal(mocked.mock.calls.length, 0);
});

test('Vercel rejects unmatched projects, aliases, commits, branches, previews, staged and rolling deployments', async (t) => {
  let observedAlias: unknown = alias();
  let observedDeployment: unknown = deployment();
  t.mock.method(globalThis, 'fetch', async (input: unknown) =>
    Response.json(
      new URL(String(input)).pathname.includes('/aliases/')
        ? observedAlias
        : observedDeployment,
    ),
  );
  for (const update of [
    { projectId: 'prj_other' },
    { alias: 'other.example.invalid' },
    { deletedAt: ready },
    { redirect: 'elsewhere.example.invalid' },
    { microfrontends: { defaultApp: {} } },
  ]) {
    observedAlias = { ...alias(), ...update };
    assert.deepEqual(await getVercelDeploymentDate(options), {
      deployedAt: null,
      error: null,
    });
  }
  observedAlias = alias();
  for (const update of [
    { projectId: 'prj_other' },
    { id: 'dpl_other' },
    { readyState: 'BUILDING' },
    { readyState: 'ERROR' },
    { target: null },
    { readySubstate: 'STAGED' },
    { readySubstate: 'ROLLING' },
    { meta: { githubCommitSha: 'b'.repeat(40), githubCommitRef: 'main' } },
    { meta: { githubCommitSha: sha, githubCommitRef: 'develop' } },
    { meta: { githubCommitSha: sha } },
    { meta: null },
    { ready: null },
    { ready: undefined },
  ]) {
    observedDeployment = { ...deployment(), ...update };
    assert.deepEqual(await getVercelDeploymentDate(options), {
      deployedAt: null,
      error: null,
    });
  }
});

test('Vercel detects alias reassignment while reading the deployment instead of attributing an obsolete date', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json(
      calls === 2
        ? deployment()
        : calls === 1
          ? alias()
          : {
              ...alias(),
              deploymentId: 'dpl_new',
              deployment: { id: 'dpl_new' },
            },
    );
  });
  assert.deepEqual(await getVercelDeploymentDate(options), {
    deployedAt: null,
    error: null,
  });
  assert.equal(calls, 3);
});

test('Vercel sanitizes HTTP and network errors from each stage without leaking tokens or response bodies', async (t) => {
  let calls = 0;
  let failAt = 1;
  let failure = () => new Response('secret-response', { status: 401 });
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === failAt
      ? failure()
      : Response.json(calls === 2 ? deployment() : alias());
  });
  for (failAt of [1, 2, 3]) {
    for (const [status, code] of [
      [401, 'VERCEL_AUTHENTICATION_FAILED'],
      [403, 'VERCEL_FORBIDDEN'],
      [404, 'VERCEL_DEPLOYMENT_UNAVAILABLE'],
      [429, 'VERCEL_RATE_LIMITED'],
      [503, 'VERCEL_REQUEST_FAILED'],
    ] as const) {
      calls = 0;
      failure = () => new Response('secret-response', { status });
      const result = await getVercelDeploymentDate(options);
      assert.equal(result.deployedAt, null);
      assert.equal(result.error?.code, code);
      assert.equal(JSON.stringify(result).includes('secret'), false);
    }
  }
  calls = 0;
  failAt = 1;
  failure = () => {
    throw new Error('secret-exception');
  };
  const result = await getVercelDeploymentDate(options);
  assert.equal(result.error?.code, 'VERCEL_REQUEST_FAILED');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Vercel validates identifiers, JSON and readiness timestamps, and limits response bytes', async (t) => {
  let calls = 0;
  let observedAlias: unknown = alias();
  let observedDeployment: unknown = deployment();
  let response: (() => Response) | undefined;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response
      ? response()
      : Response.json(calls === 2 ? observedDeployment : observedAlias);
  });
  for (const value of [
    [],
    null,
    { ...alias(), deploymentId: '../escape' },
    { ...alias(), deployment: { id: 'dpl_wrong' } },
  ]) {
    calls = 0;
    observedAlias = value;
    assert.equal(
      (await getVercelDeploymentDate(options)).error?.code,
      'VERCEL_INVALID_RESPONSE',
    );
  }
  observedAlias = alias();
  for (const value of [
    [],
    { ...deployment(), ready: true },
    { ...deployment(), ready: -1 },
    { ...deployment(), ready: 1.5 },
    { ...deployment(), ready: 253402300800000 },
  ]) {
    calls = 0;
    observedDeployment = value;
    assert.equal(
      (await getVercelDeploymentDate(options)).error?.code,
      'VERCEL_INVALID_RESPONSE',
    );
  }
  for (const factory of [
    () => new Response('<html>Not JSON</html>'),
    () => new Response(`{}${' '.repeat(256 * 1024)}`),
    () =>
      new Response('{}', {
        headers: { 'content-length': String(256 * 1024 + 1) },
      }),
  ]) {
    response = factory;
    assert.equal(
      (await getVercelDeploymentDate(options)).error?.code,
      'VERCEL_INVALID_RESPONSE',
    );
  }
});

test('Vercel includes body reading and the final alias confirmation in one timeout budget', async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: unknown, init?: RequestInit) => {
      calls++;
      if (calls < 3) return Response.json(calls === 1 ? alias() : deployment());
      return new Response(
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
    },
  );
  const result = await getVercelDeploymentDate(options, 20);
  assert.equal(result.deployedAt, null);
  assert.equal(result.error?.code, 'TIMEOUT');
  assert.equal(calls, 3);
});
