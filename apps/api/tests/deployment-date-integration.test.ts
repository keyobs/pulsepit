import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  type DeploymentEnvironment,
  DeploymentsResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { collectDeploymentDates } from '../src/services/deployment-date.service.js';
import {
  getDeploymentDateSources,
  loadRepositoryDeploymentConfig,
} from '../src/services/repository-config.service.js';

const git = promisify(execFile);
const sha = 'a'.repeat(40);
const dateSource = { type: 'github-pages', environment: 'github-pages' };
const definition = (environment = 'staging') => ({
  label: 'Test',
  branch: 'develop',
  url: `https://keyobs.github.io/project/${environment}/`,
  hosting: null,
  metadata: {
    type: 'static',
    url: `https://metadata.example.invalid/${environment}`,
  },
  deploymentDate: dateSource,
});
const beacon = (env = 'staging') => ({
  protocolVersion: 1,
  app: {
    name: 'project',
    env,
    version: '1.2.3',
    commit: sha,
    deployedAt: null,
  },
});
const deployedAt = '2026-10-21T13:00:36Z';

async function fixture(
  t: TestContext,
  deployments: unknown = { staging: definition() },
) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-date-integration-'));
  const path = join(root, 'project');
  const file = join(root, 'config.json');
  await mkdir(path);
  await git('git', ['init', '--initial-branch=develop', path]);
  await git(
    'git',
    ['remote', 'add', 'origin', 'git@github.com:keyobs/project.git'],
    { cwd: path },
  );
  const write = (value: unknown) =>
    writeFile(
      file,
      JSON.stringify({ repositories: { [path]: { deployments: value } } }),
    );
  await write(deployments);
  const config = await loadRepositoryDeploymentConfig(file);
  const app = buildApp(
    { port: 3001, scanPaths: [root], githubToken: 'server-secret' },
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
  return { app, config, root, path, file, read, write };
}

test('date source configuration validates at startup and never leaks through list/detail or triggers collection there', async (t) => {
  const { app, path, file, config, write } = await fixture(t);
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected remote call.');
  });
  assert.deepEqual(getDeploymentDateSources(path, config.environments), {
    staging: dateSource,
  });
  for (const url of [
    '/api/repositories',
    `/api/repositories/detail?${new URLSearchParams({ path })}`,
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes('deploymentDate'), false);
    assert.equal(response.body.includes('metadata.example.invalid'), false);
  }
  assert.equal(mocked.mock.calls.length, 0);
  for (const deploymentDate of [
    null,
    [],
    { type: 'vercel', environment: 'production' },
    { type: 'github-pages' },
    { ...dateSource, environment: ' ' },
    { ...dateSource, environment: 5 },
    { ...dateSource, token: 'secret-value' },
  ]) {
    await write({ staging: { ...definition(), deploymentDate } });
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

test('deployment route combines the served beacon with GitHub Pages success and only sends the token to GitHub', async (t) => {
  const { read, path } = await fixture(t);
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.href);
      if (url.hostname === 'metadata.example.invalid') {
        assert.equal(new Headers(init?.headers).has('authorization'), false);
        return Response.json(beacon());
      }
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer server-secret',
      );
      assert.ok(url.pathname.startsWith('/repos/keyobs/project/deployments'));
      if (url.pathname.endsWith('/deployments')) {
        assert.equal(url.searchParams.get('environment'), 'github-pages');
        assert.equal(url.searchParams.get('sha'), sha);
        return Response.json([
          {
            id: 123,
            sha,
            ref: 'develop',
            environment: 'github-pages',
            task: 'deploy',
          },
        ]);
      }
      return Response.json([
        {
          id: 124,
          state: 'success',
          environment: 'github-pages',
          environment_url: definition().url,
          created_at: deployedAt,
        },
      ]);
    },
  );
  const response = await read();
  assert.equal(response.statusCode, 200);
  const parsed = DeploymentsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  const [entry] = parsed.environments;
  assert.equal(entry.environment, 'staging');
  assert.equal(entry.version, '1.2.3');
  assert.equal(entry.commit, sha);
  assert.equal(entry.deployedAt, '2026-10-21T13:00:36.000Z');
  assert.equal(entry.deploymentSource, 'provider');
  assert.equal(entry.metadataError, null);
  assert.ok(entry.metadataCheckedAt);
  assert.equal(calls.length, 3);
  assert.equal(response.body.includes('server-secret'), false);
  assert.equal(response.body.includes('deploymentDate'), false);
});

test('provider errors stay partial, retain the served version/commit and leave other environments usable', async (t) => {
  const { read } = await fixture(t, {
    staging: definition(),
    production: { ...definition('production'), deploymentDate: undefined },
  });
  let status = 429;
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname === 'metadata.example.invalid')
      return Response.json(beacon(url.pathname.slice(1)));
    return new Response('secret-upstream-body', { status });
  });
  for (const [http, code] of [
    [429, 'GITHUB_RATE_LIMITED'],
    [401, 'GITHUB_AUTHENTICATION_FAILED'],
    [404, 'GITHUB_REPOSITORY_UNAVAILABLE'],
  ] as const) {
    status = http;
    const response = await read();
    assert.equal(response.statusCode, 200);
    const [staging, production] = DeploymentsResponse.parse(
      response.json(),
    ).environments;
    assert.equal(staging.version, '1.2.3');
    assert.equal(staging.commit, sha);
    assert.equal(staging.deployedAt, null);
    assert.equal(staging.deploymentSource, null);
    assert.equal(staging.metadataError?.code, code);
    assert.ok(staging.metadataCheckedAt);
    assert.equal(production.metadataError, null);
    assert.equal(production.version, '1.2.3');
    assert.equal(response.body.includes('secret'), false);
  }
});

test('explicit delivery dates take precedence and missing beacon evidence or date settings prevents provider calls', async (t) => {
  const { read } = await fixture(t, {
    staging: definition(),
    noCommit: definition('noCommit'),
    noUrl: { ...definition('noUrl'), url: null },
    noSettings: { ...definition('noSettings'), deploymentDate: undefined },
    noMetadata: { ...definition('noMetadata'), metadata: undefined },
    badBeacon: definition('badBeacon'),
  });
  const mocked = t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'metadata.example.invalid');
    const env = url.pathname.slice(1);
    const document = beacon(env);
    if (env === 'badBeacon') return new Response('Invalid JSON');
    return Response.json({
      ...document,
      app: {
        ...document.app,
        deployedAt: env === 'staging' ? deployedAt : null,
        commit: env === 'noCommit' ? null : sha,
      },
    });
  });
  const response = await read();
  const entries = DeploymentsResponse.parse(response.json()).environments;
  assert.equal(entries[0].deployedAt, deployedAt);
  assert.equal(entries[0].deploymentSource, 'delivery');
  assert.equal(entries[1].commit, null);
  assert.equal(entries.at(-1)?.metadataError?.code, 'INVALID_RESPONSE');
  for (const entry of entries.slice(1, -1)) {
    assert.equal(entry.deployedAt, null);
    assert.equal(entry.metadataError, null);
  }
  assert.equal(mocked.mock.calls.length, 5);
});

test('a missing match is a successful unknown date and non-GitHub origins produce a local partial error', async (t) => {
  const { read, path, app, root } = await fixture(t);
  let githubCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    if (new URL(String(input)).hostname === 'metadata.example.invalid')
      return Response.json(beacon());
    githubCalls++;
    return Response.json([]);
  });
  let [entry] = DeploymentsResponse.parse((await read()).json()).environments;
  assert.equal(entry.deployedAt, null);
  assert.equal(entry.metadataError, null);
  assert.equal(githubCalls, 1);
  await git(
    'git',
    ['remote', 'set-url', 'origin', 'git@gitlab.com:keyobs/project.git'],
    { cwd: path },
  );
  [entry] = DeploymentsResponse.parse((await read()).json()).environments;
  assert.equal(entry.metadataError?.code, 'GITHUB_REPOSITORY_UNAVAILABLE');
  assert.equal(entry.version, '1.2.3');
  assert.equal(entry.commit, sha);
  assert.equal(githubCalls, 1);
  for (const [url, expected] of [
    ['/api/repositories/deployments', 400],
    [
      `/api/repositories/deployments?${new URLSearchParams({ path: root })}`,
      404,
    ],
  ] as const) {
    assert.equal(
      (await app.inject({ method: 'GET', url })).statusCode,
      expected,
    );
  }
  assert.equal(githubCalls, 1);
});

test('date enrichment limits provider concurrency to four and preserves card order', async (t) => {
  const { path } = await fixture(t);
  const entries: DeploymentEnvironment[] = Array.from(
    { length: 7 },
    (_, i) => ({
      environment: `env${i}`,
      label: `Environment ${i}`,
      branch: 'develop',
      url: 'https://keyobs.github.io/project/',
      hosting: null,
      version: '1.2.3',
      commit: sha,
      deployedAt: null,
      deploymentSource: null,
      metadataCheckedAt: '2026-10-21T12:00:00Z',
      metadataError: null,
    }),
  );
  const sources = Object.fromEntries(
    entries.map((entry) => [
      entry.environment,
      { type: 'github-pages' as const, environment: 'github-pages' },
    ]),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const fourStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let active = 0;
  let maximum = 0;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    if (calls === 4) started();
    await gate;
    active--;
    return Response.json([]);
  });
  const collecting = collectDeploymentDates(path, entries, sources);
  try {
    await fourStarted;
    assert.equal(calls, 4);
  } finally {
    release();
  }
  const results = await collecting;
  assert.equal(maximum, 4);
  assert.equal(calls, 7);
  assert.deepEqual(
    results.map((entry) => entry.environment),
    entries.map((entry) => entry.environment),
  );
  assert.equal(
    results.every(
      (entry) => entry.metadataError === null && entry.deployedAt === null,
    ),
    true,
  );
  assert.equal(entries[0].metadataCheckedAt, '2026-10-21T12:00:00Z');
});
