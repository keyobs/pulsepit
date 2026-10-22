import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  ListRepositoriesResponse,
  Repository,
  RepositoryBeacon,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { loadRepositoryDeploymentConfig } from '../src/services/repository-config.service.js';

const declared = {
  name: 'project',
  devDependencies: { '@keyobs/pulsepit-beacon': '0.1.1' },
};
const environment = (metadata = true) => ({
  label: 'Production',
  branch: 'main',
  url: 'https://app.example.invalid/',
  hosting: null,
  ...(metadata
    ? {
        metadata: {
          type: 'static',
          url: 'https://metadata.example.invalid/pulsepit-deployment.json',
        },
      }
    : {}),
});

async function fixture(
  t: TestContext,
  cases: Record<string, { manifest?: unknown; settings?: unknown }>,
) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-beacon-routes-'));
  const scan = join(root, 'projects');
  const missing = join(root, 'missing');
  const outside = join(root, 'outside');
  const paths = Object.fromEntries(
    Object.keys(cases).map((name) => [name, join(scan, name)]),
  );
  const repositories: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(cases)) {
    const path = paths[name];
    await mkdir(join(path, '.git'), { recursive: true });
    if (entry.manifest !== undefined)
      await writeFile(
        join(path, 'package.json'),
        JSON.stringify(entry.manifest),
      );
    repositories[path] = entry.settings ?? {};
  }
  repositories[outside] = { deployments: [] };
  repositories.relative = null;
  const file = join(root, 'config.json');
  await writeFile(file, JSON.stringify({ repositories }));
  const config = await loadRepositoryDeploymentConfig(file, {
    isolateInvalidRepositories: true,
  });
  const app = buildApp(
    { port: 3001, scanPaths: [scan, missing] },
    config.urls,
    config.hosting,
    config.environments,
    config.errors,
  );
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const readList = () =>
    app.inject({ method: 'GET', url: '/api/repositories' });
  const readDetail = (path: string) =>
    app.inject({
      method: 'GET',
      url: `/api/repositories/detail?${new URLSearchParams({ path })}`,
    });
  return { app, root, paths, missing, outside, readList, readDetail };
}

test('list and detail expose the required beacon object and every local configuration state without remote calls', async (t) => {
  const { paths, readList, readDetail } = await fixture(t, {
    ready: {
      manifest: declared,
      settings: { deployments: { production: environment() } },
    },
    partial: {
      manifest: declared,
      settings: {
        deployments: { production: environment(), staging: environment(false) },
      },
    },
    packageOnly: { manifest: declared },
    sourceOnly: {
      manifest: {},
      settings: { deployments: { production: environment() } },
    },
    invalid: {
      manifest: declared,
      settings: {
        deployments: { production: { ...environment(), label: ' ' } },
      },
    },
    empty: {},
    legacy: {
      manifest: declared,
      settings: { urls: { production: 'https://app.example.invalid/' } },
    },
    providerOnly: {
      manifest: declared,
      settings: {
        deployments: {
          production: {
            ...environment(false),
            deploymentDate: { type: 'vercel', projectId: 'prj_project' },
          },
        },
      },
    },
  });
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  const response = await readList();
  assert.equal(response.statusCode, 200);
  const parsed = ListRepositoriesResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  const expected: Record<string, RepositoryBeacon> = {
    ready: { package: true, configuration: 'ok', active: true },
    partial: { package: true, configuration: 'partial', active: true },
    packageOnly: { package: true, configuration: 'missing', active: false },
    sourceOnly: { package: false, configuration: 'ok', active: false },
    invalid: { package: true, configuration: 'invalid', active: false },
    empty: { package: false, configuration: 'missing', active: false },
    legacy: { package: true, configuration: 'missing', active: false },
    providerOnly: { package: true, configuration: 'missing', active: false },
  };
  assert.equal(parsed.repositories.length, Object.keys(expected).length);
  for (const [name, beacon] of Object.entries(expected)) {
    const repository = parsed.repositories.find(
      (entry) => entry.path === paths[name],
    );
    assert.ok(repository);
    assert.deepEqual(repository.beacon, beacon);
    const detail = await readDetail(paths[name]);
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(Repository.parse(detail.json()), detail.json());
    assert.deepEqual(detail.json().beacon, beacon);
    assert.equal(detail.body.includes('metadata.example.invalid'), false);
    assert.equal(detail.body.includes('prj_project'), false);
  }
  assert.equal(mocked.mock.calls.length, 0);
});

test('configuration errors appear only for discovered repositories, preserve scan failures and disable invalid targets', async (t) => {
  const { app, root, paths, missing, outside, readList, readDetail } =
    await fixture(t, {
      good: {
        manifest: declared,
        settings: { deployments: { production: environment() } },
      },
      bad: {
        manifest: declared,
        settings: {
          deployments: {
            production: {
              ...environment(),
              metadata: {
                type: 'static',
                url: 'https://user:private-secret@example.invalid/',
              },
            },
          },
        },
      },
    });
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  const response = await readList();
  const parsed = ListRepositoriesResponse.parse(response.json());
  assert.deepEqual(
    parsed.scanErrors.map(({ path, code }) => ({ path, code })),
    [
      { path: missing, code: 'ENOENT' },
      { path: paths.bad, code: 'INVALID_REPOSITORY_CONFIGURATION' },
    ],
  );
  assert.equal(response.body.includes('private-secret'), false);
  assert.equal(
    parsed.scanErrors.some(
      (error) => error.path === outside || error.path === 'relative',
    ),
    false,
  );
  const detail = await readDetail(paths.bad);
  assert.deepEqual(detail.json().beacon, {
    package: true,
    configuration: 'invalid',
    active: false,
  });
  assert.deepEqual(detail.json().urls, {});
  assert.deepEqual(detail.json().hosting, {});
  assert.deepEqual(detail.json().deploymentEnvironments, []);
  const query = new URLSearchParams({ path: paths.bad });
  const deployments = await app.inject({
    method: 'GET',
    url: `/api/repositories/deployments?${query}`,
  });
  assert.equal(deployments.statusCode, 200);
  assert.deepEqual(deployments.json(), { path: paths.bad, environments: [] });
  const monitoring = await app.inject({
    method: 'POST',
    url: '/api/repositories/monitoring',
    payload: { path: paths.bad },
  });
  assert.equal(monitoring.statusCode, 200);
  assert.equal(monitoring.json().configured, false);
  assert.equal((await readDetail(root)).statusCode, 404);
  assert.equal((await readDetail(outside)).statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/repositories/detail' }))
      .statusCode,
    400,
  );
  assert.equal(mocked.mock.calls.length, 0);
});

test('repository beacon follows uncommitted manifest edits and preserves configuration when the manifest is unreadable', async (t) => {
  const { paths, readList, readDetail } = await fixture(t, {
    project: {
      manifest: {},
      settings: { deployments: { production: environment() } },
    },
  });
  const file = join(paths.project, 'package.json');
  assert.deepEqual((await readDetail(paths.project)).json().beacon, {
    package: false,
    configuration: 'ok',
    active: false,
  });
  await writeFile(file, JSON.stringify(declared));
  assert.deepEqual((await readDetail(paths.project)).json().beacon, {
    package: true,
    configuration: 'ok',
    active: true,
  });
  assert.deepEqual(
    ListRepositoriesResponse.parse((await readList()).json()).repositories[0]
      .beacon,
    { package: true, configuration: 'ok', active: true },
  );
  await writeFile(file, '{invalid JSON');
  assert.deepEqual((await readDetail(paths.project)).json().beacon, {
    package: false,
    configuration: 'ok',
    active: false,
  });
});

test('shared repository contract rejects the previous boolean beacon and requires all object fields', async (t) => {
  const { paths, readDetail } = await fixture(t, { project: {} });
  const repository = Repository.parse((await readDetail(paths.project)).json());
  for (const beacon of [
    undefined,
    null,
    true,
    false,
    {},
    { package: true, configuration: 'ok' },
    { package: true, configuration: 'unknown', active: false },
  ]) {
    assert.equal(
      Repository.safeParse({ ...repository, beacon }).success,
      false,
    );
  }
  assert.deepEqual(RepositoryBeacon.parse(repository.beacon), {
    package: false,
    configuration: 'missing',
    active: false,
  });
});
