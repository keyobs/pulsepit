import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  DeploymentCommitComparison,
  DeploymentEnvironment,
  DeploymentsResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { loadRepositoryDeploymentConfig } from '../src/services/repository-config.service.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function commit(path: string, message: string) {
  await git(
    path,
    '-c',
    'user.name=Route Test',
    '-c',
    'user.email=route@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    message,
  );
  return git(path, 'rev-parse', 'HEAD');
}

type Definition = {
  branch: string | null;
  commit?: string;
  provider?: boolean;
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-comparison-routes-'));
  const path = join(root, 'project');
  await execute('git', ['init', '--initial-branch=main', path]);
  const base = await commit(path, 'Initial');
  await commit(path, 'Second');
  const tip = await commit(path, 'Third');
  await git(path, 'branch', 'develop', base);
  await git(path, 'checkout', '-b', 'divergent', base);
  const divergent = await commit(path, 'Other history');
  await git(path, 'checkout', 'main');
  const apps: ReturnType<typeof buildApp>[] = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await rm(root, { recursive: true, force: true });
  });
  async function start(definitions: Record<string, Definition>) {
    const deployments = Object.fromEntries(
      Object.entries(definitions).map(([environment, entry]) => [
        environment,
        {
          label: environment,
          branch: entry.branch,
          url: entry.provider
            ? 'https://application.example.invalid/'
            : `https://application.example.invalid/${environment}`,
          hosting: { label: 'Host', url: null },
          ...(entry.commit !== undefined
            ? {
                metadata: {
                  type: 'static',
                  url: `https://metadata.example.invalid/${environment}`,
                },
              }
            : {}),
          ...(entry.provider
            ? {
                deploymentDate: {
                  type: 'vercel',
                  projectId: 'prj_privateproject',
                },
              }
            : {}),
        },
      ]),
    );
    const file = join(root, 'config.json');
    await writeFile(
      file,
      JSON.stringify({ repositories: { [path]: { deployments } } }),
    );
    const config = await loadRepositoryDeploymentConfig(file);
    const app = buildApp(
      { port: 3001, scanPaths: [root] },
      config.urls,
      config.hosting,
      config.environments,
    );
    apps.push(app);
    const read = () =>
      app.inject({
        method: 'GET',
        url: `/api/repositories/deployments?${new URLSearchParams({ path })}`,
      });
    return { app, read };
  }
  return { root, path, base, tip, divergent, start };
}

function beacon(
  environment: string,
  commit: string,
  deployedAt: string | null = '2026-10-21T12:00:00Z',
) {
  return {
    protocolVersion: 1,
    app: {
      name: 'project',
      env: environment,
      version: '1.2.3',
      commit,
      deployedAt,
    },
  };
}

test('HTTP deployments expose every comparison state in configured order without changing refs or fetching', async (t) => {
  const { path, base, tip, divergent, start } = await fixture(t);
  const definitions: Record<string, Definition> = {
    production: { branch: 'main', commit: base },
    staging: { branch: 'develop', commit: base },
    ahead: { branch: 'develop', commit: tip },
    divergent: { branch: 'main', commit: divergent },
    missing: { branch: 'main', commit: 'f'.repeat(40) },
    noBranch: { branch: null, commit: base },
    noSource: { branch: 'main' },
  };
  const { read } = await start(definitions);
  const refs = await git(
    path,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
  );
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://metadata.example.invalid');
      assert.equal(init?.method, 'GET');
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      const environment = url.pathname.slice(1);
      calls.push(environment);
      return Response.json(
        beacon(environment, definitions[environment].commit as string),
      );
    },
  );
  const response = await read();
  assert.equal(response.statusCode, 200);
  const parsed = DeploymentsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  assert.deepEqual(
    parsed.environments.map((entry) => entry.environment),
    Object.keys(definitions),
  );
  assert.deepEqual(
    parsed.environments.map(({ comparison }) => [
      comparison.status,
      comparison.ahead,
      comparison.behind,
      comparison.reason,
    ]),
    [
      ['behind', 0, 2, null],
      ['up_to_date', 0, 0, null],
      ['ahead', 2, 0, null],
      ['diverged', 1, 2, null],
      ['unknown', null, null, 'COMMIT_NOT_FOUND'],
      ['unknown', null, null, 'BRANCH_NOT_CONFIGURED'],
      ['unknown', null, null, 'COMMIT_UNAVAILABLE'],
    ],
  );
  assert.equal(parsed.environments[0].comparison.reference, 'refs/heads/main');
  assert.equal(parsed.environments[0].comparison.referenceCommit, tip);
  assert.equal(parsed.environments[0].version, '1.2.3');
  assert.equal(parsed.environments[0].commit, base);
  assert.equal(parsed.environments[0].deploymentSource, 'delivery');
  assert.equal(parsed.environments[0].metadataError, null);
  assert.equal(calls.length, 6);
  assert.equal(response.body.includes('metadata.example.invalid'), false);
  assert.equal(
    await git(path, 'for-each-ref', '--format=%(refname) %(objectname)'),
    refs,
  );
});

test('provider date failures preserve usable beacon commits while metadata failures keep comparison unknown', async (t) => {
  const { base, start } = await fixture(t);
  const { read } = await start({
    provider: { branch: 'main', commit: base, provider: true },
    failed: { branch: 'main', commit: base },
    absent: { branch: 'main' },
  });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://metadata.example.invalid');
    calls.push(url.pathname);
    return url.pathname === '/failed'
      ? new Response(null, { status: 503 })
      : Response.json(beacon('provider', base, null));
  });
  const response = await read();
  assert.equal(response.statusCode, 200);
  const [provider, failed, absent] = DeploymentsResponse.parse(
    response.json(),
  ).environments;
  assert.equal(provider.metadataError?.code, 'VERCEL_TOKEN_REQUIRED');
  assert.equal(provider.deployedAt, null);
  assert.equal(provider.commit, base);
  assert.equal(provider.comparison.behind, 2);
  assert.equal(provider.comparison.reason, null);
  assert.equal(failed.metadataError?.code, 'HTTP_ERROR');
  assert.equal(failed.comparison.reason, 'COMMIT_UNAVAILABLE');
  assert.equal(failed.comparison.behind, null);
  assert.equal(absent.metadataError, null);
  assert.equal(absent.comparison.reason, 'COMMIT_UNAVAILABLE');
  assert.deepEqual(calls.sort(), ['/failed', '/provider']);
  assert.equal(response.body.includes('prj_privateproject'), false);
});

test('empty deployments and invalid or out-of-scope HTTP requests do not start remote collection', async (t) => {
  const { root, start } = await fixture(t);
  const { app, read } = await start({});
  const calls = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected remote call.');
  });
  const response = await read();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(DeploymentsResponse.parse(response.json()).environments, []);
  for (const [url, status] of [
    ['/api/repositories/deployments', 400],
    ['/api/repositories/deployments?path=%20', 400],
    [
      `/api/repositories/deployments?${new URLSearchParams({ path: root })}`,
      404,
    ],
    [
      `/api/repositories/deployments?${new URLSearchParams({ path: join(root, 'missing') })}`,
      404,
    ],
  ] as const)
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, status);
  assert.equal(calls.mock.calls.length, 0);
});

test('shared deployment contracts require comparison and reject contradictory states or counters', () => {
  const comparison = {
    reference: 'refs/heads/main',
    referenceCommit: 'a'.repeat(40),
    status: 'behind',
    ahead: 0,
    behind: 2,
    reason: null,
  };
  const environment = {
    environment: 'production',
    label: 'Production',
    branch: 'main',
    url: null,
    hosting: null,
    version: null,
    commit: null,
    deployedAt: null,
    deploymentSource: null,
    metadataCheckedAt: null,
    metadataError: null,
    comparison,
  };
  assert.equal(DeploymentEnvironment.safeParse(environment).success, true);
  for (const invalid of [undefined, null, false]) {
    assert.equal(
      DeploymentEnvironment.safeParse({ ...environment, comparison: invalid })
        .success,
      false,
    );
  }
  for (const invalid of [
    { ...comparison, ahead: null },
    { ...comparison, behind: -1 },
    { ...comparison, status: 'up_to_date' },
    { ...comparison, status: 'ahead' },
    { ...comparison, status: 'diverged' },
    { ...comparison, referenceCommit: null },
    { ...comparison, status: 'unknown', reason: 'SHALLOW_HISTORY' },
    {
      ...comparison,
      status: 'unknown',
      ahead: null,
      behind: null,
      reason: null,
    },
  ])
    assert.equal(DeploymentCommitComparison.safeParse(invalid).success, false);
});

test('HTTP comparisons limit local Git concurrency to four and retain environment order', async (t) => {
  const { root, base, start } = await fixture(t);
  const definitions = Object.fromEntries(
    Array.from({ length: 7 }, (_, i) => [
      `env${i}`,
      { branch: 'main', commit: base },
    ]),
  );
  const { read } = await start(definitions);
  t.mock.method(globalThis, 'fetch', async (input: unknown) =>
    Response.json(beacon(new URL(String(input)).pathname.slice(1), base)),
  );
  const realGit = (await execute('which', ['git'])).stdout.trim();
  const bin = join(root, 'bin');
  const starts = join(root, 'starts');
  const release = join(root, 'release');
  await mkdir(bin);
  await mkdir(starts);
  await writeFile(
    join(bin, 'git'),
    `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'check-ref-format') {
  fs.writeFileSync(${JSON.stringify(starts)} + '/' + process.pid, '');
  const deadline = Date.now() + 4000;
  while (!fs.existsSync(${JSON.stringify(release)}) && Date.now() < deadline)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
  const pending = read();
  try {
    const deadline = Date.now() + 3000;
    while ((await readdir(starts)).length < 4 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await readdir(starts)).length, 4);
  } finally {
    await writeFile(release, 'continue');
  }
  const response = await pending;
  assert.equal(response.statusCode, 200);
  const parsed = DeploymentsResponse.parse(response.json());
  assert.deepEqual(
    parsed.environments.map((entry) => entry.environment),
    Object.keys(definitions),
  );
  assert.ok(
    parsed.environments.every((entry) => entry.comparison.behind === 2),
  );
  assert.equal((await readdir(starts)).length, 7);
});
