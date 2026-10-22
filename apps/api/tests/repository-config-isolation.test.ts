import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { collectDeploymentMetadata } from '../src/services/beacon/deployment-metadata.service.js';
import { inspectRepositoryBeacon } from '../src/services/beacon/repository-beacon.service.js';
import {
  getDeploymentDateSources,
  getDeploymentEnvironments,
  getDeploymentMetadataSources,
  loadRepositoryDeploymentConfig,
} from '../src/services/repositories/repository-config.service.js';

const source = {
  type: 'static' as const,
  url: 'https://metadata.example.invalid/pulsepit-deployment.json',
};
const environment = {
  label: 'Production',
  branch: 'main',
  url: 'https://app.example.invalid/',
  hosting: null,
  metadata: source,
};
const isolate = { isolateInvalidRepositories: true };

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-config-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'config.json');
  const good = join(root, 'good');
  const bad = join(root, 'bad');
  const write = (repositories: unknown) =>
    writeFile(file, JSON.stringify({ repositories }));
  return { root, file, good, bad, write };
}

test('isolation retains healthy repository settings and quarantines a malformed repository without exposing URL credentials', async (t) => {
  const { file, good, bad, write } = await fixture(t);
  await write({
    [bad]: {
      deployments: {
        production: {
          ...environment,
          metadata: {
            ...source,
            url: 'https://user:private-secret@example.invalid/',
          },
        },
      },
    },
    [good]: { deployments: { production: environment } },
  });
  const config = await loadRepositoryDeploymentConfig(file, isolate);
  assert.equal(config.errors?.[bad].code, 'INVALID_REPOSITORY_CONFIGURATION');
  assert.equal(config.errors?.[good], undefined);
  assert.equal(config.environments[good][0].metadata?.url, source.url);
  assert.deepEqual(config.urls[good], { production: environment.url });
  assert.deepEqual(config.urls[bad], {});
  assert.deepEqual(config.hosting[bad], {});
  assert.deepEqual(config.environments[bad], []);
  assert.equal(JSON.stringify(config).includes('private-secret'), false);
  await assert.rejects(loadRepositoryDeploymentConfig(file));
});

test('duplicate normalized repository paths disable both competing entries while preserving unrelated repositories', async (t) => {
  const { file, good, bad, write } = await fixture(t);
  for (const entries of [
    [
      [bad, { deployments: { production: environment } }],
      [`${bad}/.`, {}],
    ],
    [
      [`${bad}/.`, {}],
      [bad, { deployments: { production: environment } }],
    ],
  ]) {
    await write(
      Object.fromEntries([
        ...entries,
        [good, { deployments: { production: environment } }],
      ]),
    );
    const config = await loadRepositoryDeploymentConfig(file, isolate);
    assert.match(
      config.errors?.[bad].message ?? '',
      /Duplicate repository configuration/,
    );
    assert.deepEqual(config.environments[bad], []);
    assert.deepEqual(config.urls[bad], {});
    assert.equal(config.environments[good].length, 1);
  }
});

test('repository failures remain local across legacy links, invalid objects, ambiguous settings and invalid providers', async (t) => {
  const { file, good, bad, write } = await fixture(t);
  for (const settings of [
    null,
    { urls: { production: 'ftp://example.invalid/' } },
    { hosting: { production: '' } },
    { deployments: [], urls: {} },
    { deployments: {}, urls: { production: environment.url } },
    {
      deployments: {
        production: environment,
        staging: {
          ...environment,
          deploymentDate: { type: 'vercel', projectId: 'bad-project' },
        },
      },
    },
  ]) {
    await write({
      [good]: { urls: { production: environment.url } },
      [bad]: settings,
    });
    const config = await loadRepositoryDeploymentConfig(file, isolate);
    assert.equal(Object.keys(config.errors ?? {}).length, 1);
    assert.equal(config.urls[good].production, environment.url);
    assert.deepEqual(config.environments[bad], []);
  }
});

test('unassignable relative paths are reported without creating targets or polluting configuration records', async (t) => {
  const { file, good } = await fixture(t);
  await writeFile(
    file,
    `{"repositories":{"__proto__":{},"relative":{},${JSON.stringify(good)}:{}}}`,
  );
  const config = await loadRepositoryDeploymentConfig(file, isolate);
  assert.equal(Object.hasOwn(config.errors ?? {}, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(config.errors), Object.prototype);
  assert.deepEqual(Object.keys(config.urls), [good]);
  assert.equal(
    config.errors?.relative.code,
    'INVALID_REPOSITORY_CONFIGURATION',
  );
});

test('missing configuration remains valid but malformed global files cannot be isolated by repository', async (t) => {
  const { root, file } = await fixture(t);
  assert.deepEqual(await loadRepositoryDeploymentConfig(file, isolate), {
    urls: {},
    hosting: {},
    environments: {},
    errors: {},
  });
  assert.deepEqual(await loadRepositoryDeploymentConfig(file), {
    urls: {},
    hosting: {},
    environments: {},
  });
  for (const text of ['{', 'null', '[]', '{"repositories":[]}']) {
    await writeFile(file, text);
    await assert.rejects(loadRepositoryDeploymentConfig(file, isolate));
  }
  await assert.rejects(
    loadRepositoryDeploymentConfig(root, isolate),
    /Unable to read/,
  );
});

test('quarantined settings expose no metadata or date sources and cannot trigger remote collection', async (t) => {
  const { file, bad, write } = await fixture(t);
  await write({
    [bad]: {
      deployments: {
        production: environment,
        staging: { ...environment, label: ' ' },
      },
    },
  });
  const config = await loadRepositoryDeploymentConfig(file, isolate);
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  const environments = getDeploymentEnvironments(
    bad,
    config.environments,
    config.urls,
    config.hosting,
  );
  assert.deepEqual(getDeploymentMetadataSources(bad, config.environments), {});
  assert.deepEqual(getDeploymentDateSources(bad, config.environments), {});
  assert.deepEqual(await collectDeploymentMetadata(environments, {}), []);
  assert.equal(mocked.mock.calls.length, 0);
});

test('beacon object reports package and configuration independently and uses the requested active key', async (t) => {
  const { root } = await fixture(t);
  const write = (manifest: unknown) =>
    writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network call.');
  });
  await write({ devDependencies: { '@keyobs/pulsepit-beacon': '0.1.1' } });
  assert.deepEqual(await inspectRepositoryBeacon(root, []), {
    package: true,
    configuration: 'missing',
    active: false,
  });
  assert.deepEqual(
    await inspectRepositoryBeacon(root, [{ metadata: source }]),
    { package: true, configuration: 'ok', active: true },
  );
  assert.deepEqual(
    await inspectRepositoryBeacon(root, [{ metadata: source }, {}]),
    { package: true, configuration: 'partial', active: true },
  );
  assert.deepEqual(
    await inspectRepositoryBeacon(root, [{ metadata: source }], true),
    { package: true, configuration: 'invalid', active: false },
  );
  await write({ dependencies: {} });
  assert.deepEqual(
    await inspectRepositoryBeacon(root, [{ metadata: source }]),
    { package: false, configuration: 'ok', active: false },
  );
  await writeFile(join(root, 'package.json'), '{');
  assert.deepEqual(
    await inspectRepositoryBeacon(root, [{ metadata: source }]),
    { package: false, configuration: 'ok', active: false },
  );
  assert.equal(mocked.mock.calls.length, 0);
});
