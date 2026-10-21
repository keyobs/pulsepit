import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type DeploymentEnvironmentConfig,
  DeploymentsResponse,
  ListRepositoriesResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { collectDeploymentMetadata } from '../src/services/deployment-metadata.service.js';
import {
  getDeploymentMetadataSources,
  loadRepositoryDeploymentConfig,
  type StaticMetadataSource,
} from '../src/services/repository-config.service.js';

const definition = (environment: string, source = true) => ({
  label: environment === 'production' ? 'Production' : 'Test',
  branch: null,
  url: `https://app.example.invalid/${environment}`,
  hosting: null,
  ...(source
    ? {
        metadata: {
          type: 'static',
          url: `https://metadata.example.invalid/${environment}`,
        },
      }
    : {}),
});
const document = (env: string) => ({
  protocolVersion: 1,
  app: {
    name: 'project',
    env,
    version: '2.4.0',
    commit: 'a'.repeat(40),
    deployedAt: null,
  },
});

async function fixture(
  t: TestContext,
  definitions: Record<string, ReturnType<typeof definition>> = {
    production: definition('production'),
  },
) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-metadata-'));
  const path = join(root, 'project');
  const file = join(root, 'config.json');
  await mkdir(join(path, '.git'), { recursive: true });
  const write = (deployments: unknown) =>
    writeFile(
      file,
      JSON.stringify({ repositories: { [path]: { deployments } } }),
    );
  await write(definitions);
  const config = await loadRepositoryDeploymentConfig(file);
  const app = buildApp(
    { port: 3001, scanPaths: [root] },
    config.urls,
    config.hosting,
    config.environments,
  );
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const read = () =>
    app.inject({
      method: 'GET',
      url: `/api/repositories/deployments?${new URLSearchParams({ path })}`,
    });
  return { root, path, file, app, config, write, read };
}

test('static sources are validated at startup and remain absent from repository list and detail', async (t) => {
  const { path, file, app, config, write } = await fixture(t);
  assert.deepEqual(getDeploymentMetadataSources(path, config.environments), {
    production: {
      type: 'static',
      url: 'https://metadata.example.invalid/production',
    },
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('No collection during listing.');
  });
  const list = await app.inject({ method: 'GET', url: '/api/repositories' });
  const repositories = ListRepositoriesResponse.parse(list.json()).repositories;
  assert.equal(repositories.length, 1);
  const detail = await app.inject({
    method: 'GET',
    url: `/api/repositories/detail?${new URLSearchParams({ path })}`,
  });
  for (const response of [list, detail]) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes('metadata.example.invalid'), false);
  }
  assert.equal('metadata' in repositories[0].deploymentEnvironments[0], false);
  assert.equal(fetch.mock.calls.length, 0);
  for (const metadata of [
    null,
    { type: 'runtime', url: 'https://example.invalid' },
    { type: 'static', url: 'ftp://example.invalid' },
    { type: 'static', url: 'https://user:secret-value@example.invalid' },
    { type: 'static', url: 'https://example.invalid', tokenEnv: 'SECRET' },
  ]) {
    await write({ production: { ...definition('production'), metadata } });
    await assert.rejects(
      loadRepositoryDeploymentConfig(file),
      (error: Error) => {
        assert.ok(error.message.includes(path));
        assert.equal(error.message.includes('secret-value'), false);
        return true;
      },
    );
  }
});

test('deployment route reads version, commit and supplied dates while preserving successful unknown dates', async (t) => {
  const { read, path } = await fixture(t, {
    production: definition('production'),
    staging: definition('staging'),
    preview: definition('preview', false),
  });
  const mocked = t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      const env = new URL(String(input)).pathname.slice(1);
      const body = document(env);
      return Response.json(
        env === 'staging'
          ? {
              ...body,
              app: { ...body.app, deployedAt: '2026-10-21T10:00:00Z' },
            }
          : body,
      );
    },
  );
  const response = await read();
  assert.equal(response.statusCode, 200);
  const parsed = DeploymentsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  const [production, staging, preview] = parsed.environments;
  for (const entry of [production, staging]) {
    assert.equal(entry.version, '2.4.0');
    assert.equal(entry.commit, 'a'.repeat(40));
    assert.equal(entry.metadataError, null);
    assert.ok(entry.metadataCheckedAt);
    assert.equal(
      new Date(entry.metadataCheckedAt).toISOString(),
      entry.metadataCheckedAt,
    );
  }
  assert.equal(production.deployedAt, null);
  assert.equal(production.deploymentSource, null);
  assert.equal(staging.deployedAt, '2026-10-21T10:00:00Z');
  assert.equal(staging.deploymentSource, 'delivery');
  assert.equal(preview.version, null);
  assert.equal(preview.commit, null);
  assert.equal(preview.metadataCheckedAt, null);
  assert.equal(preview.metadataError, null);
  assert.equal(mocked.mock.calls.length, 2);
});

test('static metadata failures remain local to their environment and reject incompatible documents', async (t) => {
  const { read } = await fixture(t, {
    production: definition('production'),
    staging: definition('staging', false),
  });
  let factory: () => Response = () => Response.json(document('production'));
  t.mock.method(globalThis, 'fetch', async () => factory());
  for (const [response, code] of [
    [() => new Response(null, { status: 503 }), 'HTTP_ERROR'],
    [
      () => {
        throw new Error('secret-network-detail');
      },
      'NETWORK_ERROR',
    ],
    [() => new Response('<html>SPA fallback</html>'), 'INVALID_RESPONSE'],
    [
      () => Response.json({ ...document('production'), protocolVersion: 2 }),
      'UNSUPPORTED_PROTOCOL',
    ],
    [() => Response.json(document('staging')), 'ENVIRONMENT_MISMATCH'],
    [
      () =>
        Response.json({
          protocolVersion: 1,
          app: { ...document('production').app, commit: 'short' },
        }),
      'INVALID_RESPONSE',
    ],
    [
      () =>
        Response.json({
          protocolVersion: 1,
          app: {
            ...document('production').app,
            deployedAt: '2026-02-30T10:00:00Z',
          },
        }),
      'INVALID_RESPONSE',
    ],
    [
      () =>
        Response.json({
          protocolVersion: 1,
          app: { name: 'project', env: 'production' },
        }),
      'INVALID_RESPONSE',
    ],
  ] as const) {
    factory = response;
    const result = await read();
    assert.equal(result.statusCode, 200);
    const [failed, unconfigured] = DeploymentsResponse.parse(
      result.json(),
    ).environments;
    assert.equal(failed.metadataError?.code, code);
    assert.equal(failed.version, null);
    assert.equal(failed.commit, null);
    assert.equal(failed.deployedAt, null);
    assert.ok(failed.metadataCheckedAt);
    assert.equal(unconfigured.metadataError, null);
    assert.equal(unconfigured.metadataCheckedAt, null);
    assert.equal(result.body.includes('secret-network-detail'), false);
  }
});

test('static metadata enforces the byte limit and includes body reading in its deadline', async (t) => {
  const environments: DeploymentEnvironmentConfig[] = [
    {
      environment: 'production',
      label: 'Production',
      branch: null,
      url: null,
      hosting: null,
    },
  ];
  const sources: Record<string, StaticMetadataSource> = {
    production: {
      type: 'static',
      url: 'https://metadata.example.invalid/production',
    },
  };
  let factory = (_init?: RequestInit): Response =>
    new Response(JSON.stringify(document('production')) + ' '.repeat(65537));
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: unknown, init?: RequestInit) => factory(init),
  );
  let [result] = await collectDeploymentMetadata(environments, sources);
  assert.equal(result.metadataError?.code, 'INVALID_RESPONSE');
  assert.ok(result.metadataError);
  assert.match(result.metadataError.message, /64 KiB/);
  factory = () =>
    Response.json(document('production'), {
      headers: { 'content-length': '65537' },
    });
  [result] = await collectDeploymentMetadata(environments, sources);
  assert.equal(result.metadataError?.code, 'INVALID_RESPONSE');
  factory = (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const timer = setTimeout(
            () => controller.error(new Error('Abort was not received.')),
            1_000,
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
  [result] = await collectDeploymentMetadata(environments, sources, 20);
  assert.equal(result.metadataError?.code, 'TIMEOUT');
});

test('static metadata collection bounds concurrency to four while preserving environment order', async (t) => {
  const environments = Array.from(
    { length: 7 },
    (_, index): DeploymentEnvironmentConfig => ({
      environment: `env${index}`,
      label: `Environment ${index}`,
      branch: null,
      url: null,
      hosting: null,
    }),
  );
  const sources = Object.fromEntries(
    environments.map(({ environment }) => [
      environment,
      {
        type: 'static' as const,
        url: `https://metadata.example.invalid/${environment}`,
      },
    ]),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let maximum = 0;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    await gate;
    active--;
    return Response.json(document(new URL(String(input)).pathname.slice(1)));
  });
  const collecting = collectDeploymentMetadata(environments, sources);
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(calls, 4);
  } finally {
    release();
  }
  const results = await collecting;
  assert.equal(maximum, 4);
  assert.equal(calls, 7);
  assert.deepEqual(
    results.map((entry) => entry.environment),
    environments.map((entry) => entry.environment),
  );
  assert.ok(results.every((entry) => entry.metadataError === null));
});
