import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import { getOutdatedDependencies } from '../src/services/outdated.service.js';

test('on-demand dependency diagnostics', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-outdated-'));
  const repository = join(root, 'repository with spaces');
  const bin = join(root, 'bin');
  const previousPath = process.env.PATH;
  const manifest = JSON.stringify({ packageManager: 'npm@11.0.0' });
  await mkdir(repository);
  await mkdir(bin);
  await promisify(execFile)('git', ['init', repository]);
  await writeFile(join(repository, 'package.json'), manifest);
  for (const manager of ['npm', 'pnpm', 'yarn']) {
    await writeFile(
      join(bin, manager),
      `#!/bin/sh
unset NODE_TEST_CONTEXT
exec "${process.execPath}" "${join(bin, 'npm.cjs')}" ${manager} "$@"
`,
      { mode: 0o755 },
    );
  }
  // A local executable exercises real subprocess exit codes without a registry.
  await writeFile(
    join(bin, 'npm.cjs'),
    `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const [manager, ...args] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync('.diagnostic-fixture.json', 'utf8'));
if (manager === 'yarn') {
  assert.equal(process.env.YARN_ENABLE_SCRIPTS, 'false');
  assert.equal(process.env.COREPACK_ENABLE_NETWORK, '0');
  if (args[0] === '--version') process.stdout.write(fixture.yarnVersion ?? '4.9.2');
  else if (args[0] === 'info') {
    assert.deepEqual(args, ['info', '--all', '--json']);
    process.stdout.write(fixture.yarnInfo);
  } else {
    assert.deepEqual([args[0], args[1], ...args.slice(3)], ['npm', 'info', '--fields', 'name,version', '--json']);
    const result = fixture.yarnPackages[args[2]];
    assert.notEqual(result, undefined, 'Unexpected registry query: ' + args[2]);
    process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result));
    process.exitCode = fixture.yarnExitCode ?? 0;
  }
} else {
assert.deepEqual(args, manager === 'npm'
  ? ['outdated', '--json', '--ignore-scripts']
  : ['--recursive', '--include-workspace-root', 'outdated', '--format', 'json']);
if (fixture.hang) setInterval(() => {}, 1000);
else {
  process.stdout.write(fixture.output);
  process.exitCode = fixture.exitCode;
}
}
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  });

  async function fixture(output: unknown, exitCode = 0, hang = false) {
    await writeFile(
      join(repository, '.diagnostic-fixture.json'),
      JSON.stringify({
        output: typeof output === 'string' ? output : JSON.stringify(output),
        exitCode,
        hang,
      }),
    );
  }

  await t.test(
    'accepts exit 1 and preserves missing versions and workspace entries',
    async () => {
      await fixture(
        {
          z: { current: '1.0.0', wanted: '1.1.0', latest: '2.0.0' },
          a: [
            { wanted: '3.0.0', latest: '3.0.0', dependent: 'web' },
            {
              current: '2.0.0',
              wanted: '3.0.0',
              latest: '3.0.0',
              dependent: 'api',
            },
          ],
        },
        1,
      );
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.packageManager, 'npm');
      assert.deepEqual(
        body.dependencies.map((entry: { name: string }) => entry.name),
        ['a', 'a', 'z'],
      );
      assert.equal(body.dependencies[0].current, null);
      assert.equal(body.dependencies[1].dependent, 'api');
      assert.equal(body.dependencies[2].wanted, '1.1.0');
      assert.equal(
        await readFile(join(repository, 'package.json'), 'utf8'),
        manifest,
      );
    },
  );

  await t.test('returns an empty report when nothing is outdated', async () => {
    await fixture({});
    assert.deepEqual(await getOutdatedDependencies(repository), {
      packageManager: 'npm',
      dependencies: [],
      error: null,
    });
  });

  await t.test(
    'rejects technical errors, invalid JSON and malformed reports',
    async () => {
      for (const output of [
        { error: { code: 'EAI_AGAIN' } },
        'not json',
        { broken: { current: '1' } },
      ]) {
        await fixture(output, 1);
        const result = await getOutdatedDependencies(repository);
        assert.ok(result.error);
        assert.ok('code' in result && result.code === 'INVALID_OUTPUT');
      }
      await fixture({}, 1);
      const result = await getOutdatedDependencies(repository);
      assert.ok('code' in result && result.code === 'COMMAND_FAILED');
      await fixture({}, 2);
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 502);
    },
  );

  await t.test(
    'validates the request and restricts paths to configured repositories',
    async () => {
      for (const payload of [{}, { path: '' }, { path: '   ' }]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload,
        });
        assert.equal(response.statusCode, 400);
      }
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: tmpdir() },
      });
      assert.equal(response.statusCode, 404);
    },
  );

  await t.test(
    'reports unsupported, undetected and invalid package managers',
    async () => {
      for (const content of [{}, { packageManager: 'invalid' }]) {
        await writeFile(
          join(repository, 'package.json'),
          JSON.stringify(content),
        );
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload: { path: repository },
        });
        assert.equal(response.statusCode, 422);
        assert.equal(response.json().code, 'PACKAGE_MANAGER');
      }
      await writeFile(join(repository, 'package.json'), manifest);
    },
  );

  await t.test('reports a missing npm executable', async () => {
    process.env.PATH = root;
    try {
      const result = await getOutdatedDependencies(repository);
      assert.ok('code' in result && result.code === 'COMMAND_FAILED');
      assert.equal(result.error, 'npm executable was not found in PATH.');
    } finally {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
    }
  });

  await t.test(
    'normalizes pnpm workspace reports and version-qualified names',
    async () => {
      await writeFile(
        join(repository, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@12.14.0' }),
      );
      await fixture(
        {
          'shared@1.0.0 (dev)': {
            current: '1.0.0',
            wanted: '1.0.0',
            latest: '3.0.0',
            dependencyType: 'devDependencies',
            dependentPackages: [
              { name: 'web', location: join(repository, 'apps/web') },
              { name: 'api', location: join(repository, 'apps/api') },
            ],
          },
          '@scope/shared@2.0.0': {
            current: '2.0.0',
            wanted: '2.0.0',
            latest: '3.0.0',
            dependentPackages: [{ location: repository }],
          },
          '@scope/other': { wanted: '1.0.0', latest: '2.0.0' },
        },
        1,
      );
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: repository },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.packageManager, 'pnpm');
      assert.equal(body.dependencies.length, 4);
      const shared = body.dependencies.filter(
        (entry: { name: string }) => entry.name === 'shared',
      );
      assert.deepEqual(
        shared.map((entry: { dependent: string }) => entry.dependent),
        ['web', 'api'],
      );
      assert.equal(shared[0].location, join(repository, 'apps/web'));
      assert.equal(shared[0].wanted, '1.0.0');
      assert.equal(
        body.dependencies.find(
          (entry: { name: string }) => entry.name === '@scope/shared',
        ).current,
        '2.0.0',
      );
      assert.equal(
        body.dependencies.find(
          (entry: { name: string }) => entry.name === '@scope/other',
        ).current,
        null,
      );
    },
  );

  await t.test(
    'accepts pnpm reports with no outdated dependencies',
    async () => {
      await fixture({});
      assert.deepEqual(await getOutdatedDependencies(repository), {
        packageManager: 'pnpm',
        dependencies: [],
        error: null,
      });
    },
  );

  await t.test(
    'rejects pnpm errors and malformed workspace entries',
    async () => {
      for (const output of [
        { error: { code: 'ERR_PNPM_OUTDATED_NO_LOCKFILE' } },
        'not json',
        { broken: { current: '1.0.0' } },
        { broken: { wanted: '1', latest: '2', dependentPackages: [] } },
        {
          broken: {
            wanted: '1',
            latest: '2',
            dependentPackages: [{ name: 'web' }],
          },
        },
      ]) {
        await fixture(output, 1);
        const result = await getOutdatedDependencies(repository);
        assert.ok('code' in result && result.code === 'INVALID_OUTPUT');
      }
      await fixture({}, 1);
      const result = await getOutdatedDependencies(repository);
      assert.ok('code' in result && result.code === 'COMMAND_FAILED');
    },
  );

  await t.test('reports a missing pnpm executable', async () => {
    process.env.PATH = root;
    try {
      const result = await getOutdatedDependencies(repository);
      assert.equal(result.error, 'pnpm executable was not found in PATH.');
    } finally {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
    }
  });

  await t.test(
    'detects pnpm from its lockfile without a packageManager field',
    async () => {
      await writeFile(join(repository, 'package.json'), '{}');
      await writeFile(
        join(repository, 'pnpm-lock.yaml'),
        'lockfileVersion: "9.0"\n',
      );
      await fixture({});
      const result = await getOutdatedDependencies(repository);
      assert.ok('packageManager' in result && result.packageManager === 'pnpm');
      await rm(join(repository, 'pnpm-lock.yaml'));
      await writeFile(join(repository, 'package.json'), manifest);
    },
  );

  await t.test('Yarn Modern diagnostics', async (y) => {
    await writeFile(
      join(repository, 'package.json'),
      JSON.stringify({ packageManager: 'yarn@4.9.2' }),
    );
    y.after(() => writeFile(join(repository, 'package.json'), manifest));
    const rootInfo = {
      value: 'project@workspace:.',
      children: {
        Dependencies: [
          { descriptor: 'shared@npm:^1.0.0', locator: 'shared@npm:1.0.0' },
          {
            descriptor: 'local@workspace:*',
            locator: 'local@workspace:apps/local',
          },
        ],
      },
    };
    async function yarnFixture(overrides: Record<string, unknown> = {}) {
      await writeFile(
        join(repository, '.diagnostic-fixture.json'),
        JSON.stringify({
          yarnInfo: JSON.stringify(rootInfo),
          yarnPackages: {
            'shared@^1.0.0': { name: 'shared', version: '1.2.0' },
            'shared@latest': { name: 'shared', version: '2.0.0' },
          },
          ...overrides,
        }),
      );
    }

    await y.test(
      'combines resolved, wanted and latest versions across workspaces',
      async () => {
        await yarnFixture({
          yarnInfo: [
            rootInfo,
            {
              value: '@scope/web@workspace:apps/web',
              children: {
                Dependencies: [
                  {
                    descriptor: 'shared@npm:^1.0.0',
                    locator: 'shared@virtual:hash#npm:1.0.0',
                  },
                ],
              },
            },
          ]
            .map((entry) => JSON.stringify(entry))
            .join('\n'),
        });
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload: { path: repository },
        });
        assert.equal(response.statusCode, 200);
        const body = response.json();
        assert.equal(body.packageManager, 'yarn');
        assert.deepEqual(body.dependencies, [
          {
            name: 'shared',
            current: '1.0.0',
            wanted: '1.2.0',
            latest: '2.0.0',
            dependent: 'project',
            location: repository,
          },
          {
            name: 'shared',
            current: '1.0.0',
            wanted: '1.2.0',
            latest: '2.0.0',
            dependent: '@scope/web',
            location: join(repository, 'apps/web'),
          },
        ]);
      },
    );

    await y.test(
      'preserves scoped npm aliases and missing resolutions',
      async () => {
        await yarnFixture({
          yarnInfo: JSON.stringify({
            value: 'project@workspace:.',
            children: {
              Dependencies: [
                { descriptor: 'alias@npm:@scope/real@^1.0.0', locator: null },
              ],
            },
          }),
          yarnPackages: {
            '@scope/real@^1.0.0': { name: '@scope/real', version: '1.2.0' },
            '@scope/real@latest': { name: '@scope/real', version: '2.0.0' },
          },
        });
        const result = await getOutdatedDependencies(repository);
        assert.ok('dependencies' in result);
        assert.equal(result.dependencies[0].name, 'alias');
        assert.equal(result.dependencies[0].current, null);
      },
    );

    await y.test(
      'returns no outdated dependencies when versions match or project is empty',
      async () => {
        await yarnFixture({
          yarnPackages: {
            'shared@^1.0.0': { name: 'shared', version: '1.0.0' },
            'shared@latest': { name: 'shared', version: '1.0.0' },
          },
        });
        assert.deepEqual(await getOutdatedDependencies(repository), {
          packageManager: 'yarn',
          dependencies: [],
          error: null,
        });
        await yarnFixture({
          yarnInfo: JSON.stringify({
            value: 'project@workspace:.',
            children: { Version: '0.0.0' },
          }),
        });
        assert.deepEqual(await getOutdatedDependencies(repository), {
          packageManager: 'yarn',
          dependencies: [],
          error: null,
        });
      },
    );

    await y.test(
      'rejects Yarn Classic based on the actual executable version',
      async () => {
        await yarnFixture({ yarnVersion: '1.22.22' });
        const response = await app.inject({
          method: 'POST',
          url: '/api/repositories/outdated',
          payload: { path: repository },
        });
        assert.equal(response.statusCode, 422);
        assert.match(response.json().error, /Classic/);
      },
    );

    await y.test(
      'rejects malformed reports, registry warnings and package name mismatches',
      async () => {
        for (const overrides of [
          { yarnVersion: 'not a version' },
          { yarnInfo: '' },
          { yarnInfo: 'not json' },
          {
            yarnInfo: JSON.stringify({
              value: 'shared@npm:1.0.0',
              children: {},
            }),
          },
          {
            yarnPackages: {
              'shared@^1.0.0':
                '{"type":"warning","data":"Unmet range"}\n{"name":"shared","version":"2.0.0"}',
            },
          },
          {
            yarnPackages: {
              'shared@^1.0.0': { name: 'unexpected', version: '1.2.0' },
              'shared@latest': { name: 'shared', version: '2.0.0' },
            },
          },
        ]) {
          await yarnFixture(overrides);
          const result = await getOutdatedDependencies(repository);
          assert.ok('code' in result && result.code === 'INVALID_OUTPUT');
        }
      },
    );

    await y.test(
      'treats nonzero registry exits as technical errors',
      async () => {
        await yarnFixture({ yarnExitCode: 1 });
        const result = await getOutdatedDependencies(repository);
        assert.ok('code' in result && result.code === 'COMMAND_FAILED');
      },
    );

    await y.test('reports a missing yarn executable', async () => {
      process.env.PATH = root;
      try {
        const result = await getOutdatedDependencies(repository);
        assert.equal(result.error, 'yarn executable was not found in PATH.');
      } finally {
        process.env.PATH = `${bin}:${previousPath ?? ''}`;
      }
    });
  });

  await t.test('terminates a hung command after 30 seconds', async () => {
    await fixture({}, 0, true);
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path: repository },
    });
    assert.equal(response.statusCode, 504);
    assert.equal(response.json().code, 'TIMEOUT');
  });
});
