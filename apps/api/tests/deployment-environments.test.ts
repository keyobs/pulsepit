import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  DeploymentsResponse,
  ErrorResponse,
  ListRepositoriesResponse,
  MonitoringRequest,
  MonitoringResponse,
  Repository,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { loadRepositoryDeploymentConfig } from '../src/services/repositories/repository-config.service.js';

const production = {
  label: 'Production',
  branch: 'main',
  url: 'https://APP.example.invalid',
  hosting: { label: 'Vercel', url: 'https://vercel.com/team/project' },
};
const staging = {
  label: 'Test',
  branch: 'develop',
  url: 'https://test.example.invalid/',
  hosting: { label: 'GitHub Pages', url: null },
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-deployments-'));
  const scan = join(root, 'projects');
  const path = join(scan, 'project');
  const file = join(root, 'config.json');
  await mkdir(path, { recursive: true });
  await promisify(execFile)('git', ['init', '--initial-branch=main', path]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = (settings: unknown) =>
    writeFile(file, JSON.stringify({ repositories: { [path]: settings } }));
  const load = () => loadRepositoryDeploymentConfig(file);
  const start = async () => {
    const config = await load();
    const app = buildApp(
      { port: 3001, scanPaths: [scan] },
      config.urls,
      config.hosting,
      config.environments,
    );
    t.after(() => app.close());
    return { app, config };
  };
  return { root, scan, path, file, write, load, start };
}

test('deployment configuration normalizes explicit labels, nullable links and compatibility views', async (t) => {
  const { path, file, write, load } = await fixture(t);
  assert.deepEqual(await load(), { urls: {}, hosting: {}, environments: {} });
  await write({
    deployments: {
      production,
      staging,
      preview: {
        label: 'Recette',
        branch: null,
        url: null,
        hosting: { label: 'Hébergement', url: null },
      },
    },
  });
  const config = await load();
  assert.deepEqual(config.environments[path], [
    {
      environment: 'production',
      ...production,
      url: 'https://app.example.invalid/',
    },
    { environment: 'staging', ...staging },
    {
      environment: 'preview',
      label: 'Recette',
      branch: null,
      url: null,
      hosting: { label: 'Hébergement', url: null },
    },
  ]);
  assert.deepEqual(config.urls[path], {
    production: 'https://app.example.invalid/',
    staging: staging.url,
  });
  assert.deepEqual(config.hosting[path], {
    production: production.hosting.url,
  });
  // Other repositories can keep their legacy format in the same file.
  const legacy = join(path, '..', 'legacy');
  await writeFile(
    file,
    JSON.stringify({
      repositories: {
        [path]: { deployments: { production } },
        [legacy]: {
          urls: { staging: staging.url },
          hosting: { production: production.hosting.url },
        },
      },
    }),
  );
  const mixedRepositories = await load();
  assert.deepEqual(mixedRepositories.environments[legacy], [
    {
      environment: 'staging',
      label: 'Test',
      branch: null,
      url: staging.url,
      hosting: null,
    },
    {
      environment: 'production',
      label: 'Production',
      branch: null,
      url: null,
      hosting: { label: 'Vercel', url: production.hosting.url },
    },
  ]);
});

test('deployment configuration rejects ambiguous or invalid settings and names the repository without leaking URL secrets', async (t) => {
  const { path, write, load } = await fixture(t);
  for (const settings of [
    { deployments: {}, urls: { production: production.url } },
    { deployments: {}, hosting: { production: production.hosting.url } },
    { deployments: [] },
    ...[
      { ...production, label: '  ' },
      { ...production, branch: ' ' },
      { ...production, branch: undefined },
      { ...production, hosting: { label: ' ', url: null } },
      { ...production, hosting: undefined },
      { ...production, url: 'ftp://app.example.invalid' },
      {
        ...production,
        url: 'https://user:secret-password@app.example.invalid',
      },
      { ...production, hosting: { label: 'Host', url: 'file:///tmp/private' } },
    ].map((entry) => ({ deployments: { production: entry } })),
    { deployments: { ' ': production } },
  ]) {
    await write(settings);
    await assert.rejects(load(), (error: Error) => {
      assert.ok(error.message.includes(path));
      assert.equal(error.message.includes('secret-password'), false);
      return true;
    });
  }
  await write({ deployments: {}, urls: {}, hosting: {} });
  assert.deepEqual((await load()).environments[path], []);
});

test('deployment route, repository list and detail expose the same local configuration without remote calls', async (t) => {
  const { path, write, start } = await fixture(t);
  await write({ deployments: { production, staging } });
  const { app, config } = await start();
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected remote call.');
  });
  const query = new URLSearchParams({ path: `${path}/.` });
  const response = await app.inject({
    method: 'GET',
    url: `/api/repositories/deployments?${query}`,
  });
  assert.equal(response.statusCode, 200);
  const parsed = DeploymentsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  assert.deepEqual(
    parsed.environments,
    config.environments[path].map((entry) => ({
      ...entry,
      version: null,
      commit: null,
      deployedAt: null,
      deploymentSource: null,
      metadataCheckedAt: null,
      metadataError: null,
      comparison: {
        reference: entry.branch === null ? null : `refs/heads/${entry.branch}`,
        referenceCommit: null,
        status: 'unknown',
        ahead: null,
        behind: null,
        reason:
          entry.branch === null
            ? 'BRANCH_NOT_CONFIGURED'
            : 'COMMIT_UNAVAILABLE',
      },
    })),
  );
  const list = ListRepositoriesResponse.parse(
    (await app.inject({ method: 'GET', url: '/api/repositories' })).json(),
  );
  const detail = Repository.parse(
    (
      await app.inject({
        method: 'GET',
        url: `/api/repositories/detail?${query}`,
      })
    ).json(),
  );
  assert.deepEqual(
    list.repositories[0].deploymentEnvironments,
    config.environments[path],
  );
  assert.deepEqual(detail.deploymentEnvironments, config.environments[path]);
  assert.deepEqual(detail.urls, config.urls[path]);
  assert.deepEqual(detail.hosting, config.hosting[path]);
  assert.equal(
    Repository.safeParse({ ...detail, deploymentEnvironments: undefined })
      .success,
    false,
  );
  assert.equal(fetch.mock.calls.length, 0);
});

test('targeted monitoring checks one application only, preserves HEAD fallback and keeps bulk requests compatible', async (t) => {
  const { path, write, start } = await fixture(t);
  await write({
    deployments: {
      production,
      staging,
      preview: {
        label: 'Recette',
        branch: null,
        url: null,
        hosting: { label: 'Host', url: null },
      },
    },
  });
  const { app } = await start();
  const calls: {
    url: string;
    method: string | undefined;
    signal: AbortSignal | null | undefined;
  }[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method,
        signal: init?.signal,
      });
      return new Response(null, {
        status:
          String(input) === staging.url && init?.method === 'HEAD' ? 405 : 200,
      });
    },
  );
  const request = async (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/monitoring',
      payload,
    });
  const response = await request(
    MonitoringRequest.parse({ path, environment: 'staging' }),
  );
  assert.equal(response.statusCode, 200);
  const parsed = MonitoringResponse.parse(response.json());
  assert.equal(parsed.configured, true);
  assert.deepEqual(
    parsed.checks.map((check) => check.environment),
    ['staging'],
  );
  assert.deepEqual(
    calls.map(({ url, method }) => ({ url, method })),
    [
      { url: staging.url, method: 'HEAD' },
      { url: staging.url, method: 'GET' },
    ],
  );
  assert.equal(calls[0].signal, calls[1].signal);
  const bulk = await request({ path });
  assert.equal(bulk.statusCode, 200);
  assert.deepEqual(
    MonitoringResponse.parse(bulk.json()).checks.map(
      (check) => check.environment,
    ),
    ['production', 'staging'],
  );
  assert.equal(
    calls.some((call) => call.url === production.hosting.url),
    false,
  );
  const count = calls.length;
  for (const environment of ['preview', 'missing', 'toString']) {
    const failure = await request({ path, environment });
    assert.equal(failure.statusCode, 404);
    assert.equal(
      ErrorResponse.parse(failure.json()).code,
      'ENVIRONMENT_NOT_FOUND',
    );
  }
  for (const environment of ['', '   ']) {
    assert.equal((await request({ path, environment })).statusCode, 400);
  }
  assert.equal(calls.length, count);
});

test('unconfigured deployments remain empty and request errors are distinct from absent metadata', async (t) => {
  const { root, path, start } = await fixture(t);
  const { app } = await start();
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/repositories/deployments?${new URLSearchParams({ path })}`,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(DeploymentsResponse.parse(response.json()), {
    path,
    environments: [],
  });
  for (const [url, status] of [
    ['/api/repositories/deployments', 400],
    [
      `/api/repositories/deployments?${new URLSearchParams({ path: ' ' })}`,
      400,
    ],
    [
      `/api/repositories/deployments?${new URLSearchParams({ path: root })}`,
      404,
    ],
  ] as const) {
    const failure = await app.inject({ method: 'GET', url });
    assert.equal(failure.statusCode, status);
    assert.ok(ErrorResponse.parse(failure.json()).error);
    assert.equal(DeploymentsResponse.safeParse(failure.json()).success, false);
  }
  assert.equal(fetch.mock.calls.length, 0);
});
