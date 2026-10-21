import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { DeploymentsResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import {
  getDeploymentDateSources,
  loadRepositoryDeploymentConfig,
} from '../src/services/repository-config.service.js';

const git = promisify(execFile);
const sha = 'b'.repeat(40);
const ready = Date.parse('2026-10-21T13:00:36Z');
const source = {
  type: 'vercel',
  projectId: 'prj_project',
  teamId: 'team_project',
};
const definition = (environment = 'production') => ({
  label: environment === 'production' ? 'Production' : 'Test',
  branch: environment === 'production' ? 'main' : 'develop',
  url:
    environment === 'production'
      ? 'https://app.example.invalid/'
      : 'https://keyobs.github.io/project/',
  hosting: null,
  metadata: {
    type: 'static',
    url: `https://metadata.example.invalid/${environment}`,
  },
  deploymentDate:
    environment === 'production'
      ? source
      : { type: 'github-pages', environment: 'github-pages' },
});
const beacon = (env: string) => ({
  protocolVersion: 1,
  app: {
    name: 'project',
    env,
    version: '2.0.0',
    commit: sha,
    deployedAt: null,
  },
});
const alias = () => ({
  alias: 'app.example.invalid',
  deploymentId: 'dpl_current',
  projectId: source.projectId,
});
const deployment = () => ({
  id: 'dpl_current',
  projectId: source.projectId,
  readyState: 'READY',
  readySubstate: 'PROMOTED',
  target: 'production',
  ready,
  meta: { gitlabCommitSha: sha, gitlabCommitRef: 'main' },
});

async function fixture(
  t: TestContext,
  options: { token?: string; deployments?: unknown; origin?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-vercel-integration-'));
  const path = join(root, 'project');
  const file = join(root, 'config.json');
  await mkdir(path);
  await git('git', ['init', '--initial-branch=main', path]);
  await git(
    'git',
    [
      'remote',
      'add',
      'origin',
      options.origin ?? 'git@gitlab.com:keyobs/project.git',
    ],
    { cwd: path },
  );
  const write = (deployments: unknown) =>
    writeFile(
      file,
      JSON.stringify({ repositories: { [path]: { deployments } } }),
    );
  await write(options.deployments ?? { production: definition() });
  const config = await loadRepositoryDeploymentConfig(file);
  const app = buildApp(
    {
      port: 3001,
      scanPaths: [root],
      githubToken: 'github-secret',
      vercelToken: options.token,
    },
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
  return { app, path, file, config, read, write };
}

test('Vercel server token is trimmed and stays absent from all public repository configuration', async (t) => {
  assert.equal(
    readConfig({ SCAN_PATH: '/tmp', VERCEL_TOKEN: ' server-secret ' })
      .vercelToken,
    'server-secret',
  );
  assert.equal(
    readConfig({ SCAN_PATH: '/tmp', VERCEL_TOKEN: ' ' }).vercelToken,
    undefined,
  );
  assert.equal(readConfig({ SCAN_PATH: '/tmp' }).vercelToken, undefined);
  const { app, path, config } = await fixture(t, { token: 'vercel-secret' });
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected remote call.');
  });
  assert.deepEqual(getDeploymentDateSources(path, config.environments), {
    production: source,
  });
  for (const url of [
    '/api/repositories',
    `/api/repositories/detail?${new URLSearchParams({ path })}`,
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200);
    for (const privateValue of [
      'vercel-secret',
      'github-secret',
      'prj_project',
      'team_project',
      'deploymentDate',
      'metadata.example.invalid',
    ]) {
      assert.equal(response.body.includes(privateValue), false);
    }
  }
  assert.equal(mocked.mock.calls.length, 0);
});

test('Vercel source accepts an optional team and rejects missing IDs, embedded secrets and unknown configuration keys', async (t) => {
  const { write, path, file } = await fixture(t);
  await write({
    production: {
      ...definition(),
      deploymentDate: { type: 'vercel', projectId: 'prj_project' },
    },
  });
  assert.deepEqual(
    getDeploymentDateSources(
      path,
      (await loadRepositoryDeploymentConfig(file)).environments,
    ),
    {
      production: { type: 'vercel', projectId: 'prj_project' },
    },
  );
  for (const deploymentDate of [
    { type: 'vercel' },
    { ...source, projectId: ' ' },
    { ...source, projectId: 'https://other.invalid' },
    { ...source, teamId: null },
    { ...source, teamId: 'bad-team' },
    { ...source, token: 'private-secret' },
    { ...source, url: 'https://other.invalid' },
    { ...source, environment: 'production' },
  ]) {
    await write({ production: { ...definition(), deploymentDate } });
    await assert.rejects(
      loadRepositoryDeploymentConfig(file),
      (error: Error) => {
        assert.ok(error.message.includes(path));
        assert.equal(error.message.includes('private-secret'), false);
        return true;
      },
    );
  }
});

test('the route enriches a GitLab-backed Vercel deployment and reserves the Vercel token for Vercel API calls', async (t) => {
  const { read } = await fixture(t, { token: 'vercel-secret' });
  let calls = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      calls++;
      if (url.hostname === 'metadata.example.invalid') {
        assert.equal(new Headers(init?.headers).has('authorization'), false);
        return Response.json(beacon('production'));
      }
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer vercel-secret',
      );
      assert.equal(url.searchParams.get('teamId'), source.teamId);
      return Response.json(
        url.pathname.includes('/aliases/') ? alias() : deployment(),
      );
    },
  );
  const response = await read();
  assert.equal(response.statusCode, 200);
  const parsed = DeploymentsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  const [entry] = parsed.environments;
  assert.equal(entry.version, '2.0.0');
  assert.equal(entry.commit, sha);
  assert.equal(entry.deployedAt, '2026-10-21T13:00:36.000Z');
  assert.equal(entry.deploymentSource, 'provider');
  assert.equal(entry.metadataError, null);
  assert.ok(entry.metadataCheckedAt);
  assert.equal(calls, 4);
  assert.equal(response.body.includes('secret'), false);
  assert.equal(response.body.includes('deploymentDate'), false);
});

test('GitHub Pages and Vercel share a response while keeping credentials and metadata isolated', async (t) => {
  const { read } = await fixture(t, {
    token: 'vercel-secret',
    origin: 'git@github.com:keyobs/project.git',
    deployments: { production: definition(), staging: definition('staging') },
  });
  const providers = new Set<string>();
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = new Headers(init?.headers).get('authorization');
      if (url.hostname === 'metadata.example.invalid') {
        assert.equal(auth, null);
        return Response.json(beacon(url.pathname.slice(1)));
      }
      providers.add(url.hostname);
      if (url.hostname === 'api.vercel.com') {
        assert.equal(auth, 'Bearer vercel-secret');
        return Response.json(
          url.pathname.includes('/aliases/') ? alias() : deployment(),
        );
      }
      assert.equal(url.hostname, 'api.github.com');
      assert.equal(auth, 'Bearer github-secret');
      return Response.json(
        url.pathname.endsWith('/statuses')
          ? [
              {
                id: 2,
                state: 'success',
                environment: 'github-pages',
                environment_url: definition('staging').url,
                created_at: '2026-10-21T12:00:00Z',
              },
            ]
          : [
              {
                id: 1,
                sha,
                ref: 'develop',
                environment: 'github-pages',
                task: 'deploy',
              },
            ],
      );
    },
  );
  const entries = DeploymentsResponse.parse((await read()).json()).environments;
  assert.deepEqual(
    entries.map(
      ({ environment, deployedAt, deploymentSource, metadataError }) => ({
        environment,
        deployedAt,
        deploymentSource,
        metadataError,
      }),
    ),
    [
      {
        environment: 'production',
        deployedAt: '2026-10-21T13:00:36.000Z',
        deploymentSource: 'provider',
        metadataError: null,
      },
      {
        environment: 'staging',
        deployedAt: '2026-10-21T12:00:00.000Z',
        deploymentSource: 'provider',
        metadataError: null,
      },
    ],
  );
  assert.deepEqual([...providers].sort(), ['api.github.com', 'api.vercel.com']);
});

test('missing tokens and Vercel failures retain beacon metadata and stay local to the affected card', async (t) => {
  let vercelCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname === 'metadata.example.invalid')
      return Response.json(beacon(url.pathname.slice(1)));
    assert.equal(url.hostname, 'api.vercel.com');
    vercelCalls++;
    return new Response('secret-upstream-body', { status: 401 });
  });
  for (const [token, code] of [
    [undefined, 'VERCEL_TOKEN_REQUIRED'],
    ['vercel-secret', 'VERCEL_AUTHENTICATION_FAILED'],
  ] as const) {
    const { read } = await fixture(t, {
      token,
      deployments: {
        production: definition(),
        staging: { ...definition('staging'), deploymentDate: undefined },
      },
    });
    const response = await read();
    assert.equal(response.statusCode, 200);
    const [production, staging] = DeploymentsResponse.parse(
      response.json(),
    ).environments;
    assert.equal(production.version, '2.0.0');
    assert.equal(production.commit, sha);
    assert.equal(production.deployedAt, null);
    assert.equal(production.deploymentSource, null);
    assert.equal(production.metadataError?.code, code);
    assert.ok(production.metadataCheckedAt);
    assert.equal(staging.metadataError, null);
    assert.equal(staging.version, '2.0.0');
    assert.equal(response.body.includes('secret'), false);
  }
  assert.equal(vercelCalls, 1);
});

test('delivery dates and missing evidence skip Vercel even when its token is absent', async (t) => {
  const { read } = await fixture(t, {
    deployments: {
      production: definition(),
      noCommit: {
        ...definition(),
        metadata: {
          type: 'static',
          url: 'https://metadata.example.invalid/noCommit',
        },
      },
      noUrl: {
        ...definition(),
        url: null,
        metadata: {
          type: 'static',
          url: 'https://metadata.example.invalid/noUrl',
        },
      },
      noBeacon: { ...definition(), metadata: undefined },
    },
  });
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, 'metadata.example.invalid');
    const env = url.pathname.slice(1);
    const body = beacon(env);
    return Response.json({
      ...body,
      app: {
        ...body.app,
        commit: env === 'noCommit' ? null : sha,
        deployedAt: env === 'production' ? '2026-10-21T11:00:00Z' : null,
      },
    });
  });
  const entries = DeploymentsResponse.parse((await read()).json()).environments;
  assert.equal(entries[0].deployedAt, '2026-10-21T11:00:00Z');
  assert.equal(entries[0].deploymentSource, 'delivery');
  for (const entry of entries) assert.equal(entry.metadataError, null);
  assert.equal(entries[1].commit, null);
  assert.equal(entries.at(-1)?.metadataCheckedAt, null);
});
