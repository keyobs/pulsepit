import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OutdatedResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { isWorkspacePath } from '../src/services/packages/package.service.js';
import { findWorkspaces } from '../src/services/packages/workspaces.service.js';

const json = (value: unknown) => JSON.stringify(value);

test('per-workspace dependency inventory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-workspaces-'));
  const projects = join(root, 'projects');
  const repo = join(projects, 'mono');
  const bin = join(root, 'bin');
  const previousPath = process.env.PATH;
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    process.env.PATH = previousPath;
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const write = async (path: string, content: string) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  };
  await mkdir(join(repo, '.git'), { recursive: true });
  await write(
    join(repo, 'package.json'),
    json({
      name: 'mono',
      packageManager: 'pnpm@10.0.0',
      devDependencies: { turbo: '^2.0.0' },
    }),
  );
  await write(
    join(repo, 'pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\n  - \"packages/*\" # shared\n  - '!packages/ignored'\n",
  );
  await write(
    join(repo, 'apps/web/package.json'),
    json({
      name: '@mono/web',
      dependencies: { react: '^19.0.0', '@mono/lib': 'workspace:*' },
    }),
  );
  await write(
    join(repo, 'packages/lib/package.json'),
    json({ name: '@mono/lib', devDependencies: { react: '^19.0.0' } }),
  );
  await write(join(repo, 'packages/ignored/package.json'), json({ name: 'x' }));
  await mkdir(join(repo, 'packages/no-manifest'), { recursive: true });
  await write(
    join(repo, 'node_modules/react/package.json'),
    json({ version: '19.1.0' }),
  );
  await write(
    join(repo, 'node_modules/turbo/package.json'),
    json({ version: '2.5.0' }),
  );
  await write(
    join(repo, 'apps/web/node_modules/@mono/lib/package.json'),
    json({ version: '0.0.0' }),
  );

  await mkdir(bin);
  const report = {
    react: {
      current: '19.1.0',
      wanted: '19.2.0',
      latest: '20.0.0',
      dependentPackages: [
        { name: '@mono/web', location: join(repo, 'apps/web') },
      ],
    },
    turbo: {
      current: '2.5.0',
      wanted: '2.5.0',
      latest: '2.6.0',
      dependentPackages: [{ name: 'mono', location: repo }],
    },
  };
  await writeFile(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(json(report))});\nprocess.exitCode = 1;\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${previousPath ?? ''}`;

  await t.test('finds workspaces from pnpm-workspace.yaml', async () => {
    assert.deepEqual(
      (await findWorkspaces(repo)).map(({ name, path }) => [name, path]),
      [
        ['@mono/web', 'apps/web'],
        ['@mono/lib', 'packages/lib'],
      ],
    );
  });

  await t.test('reports each package with its own versions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path: repo },
    });
    assert.equal(response.statusCode, 200);
    const body = OutdatedResponse.parse(response.json());
    assert.deepEqual(
      body.packages.map(({ name, status, latest }) => [name, status, latest]),
      [['turbo', 'outdated', '2.6.0']],
    );
    assert.deepEqual(
      body.workspaces.map(({ path, packages }) => [
        path,
        packages.map(({ name, section, installed, status }) => [
          name,
          section,
          installed,
          status,
        ]),
      ]),
      [
        [
          'apps/web',
          [
            ['@mono/lib', 'dependencies', '0.0.0', 'current'],
            ['react', 'dependencies', '19.1.0', 'outdated'],
          ],
        ],
        ['packages/lib', [['react', 'devDependencies', '19.1.0', 'current']]],
      ],
    );
  });

  await t.test(
    'diagnoses standalone sub-projects in their folder',
    async () => {
      const split = join(projects, 'split');
      await mkdir(join(split, '.git'), { recursive: true });
      await write(
        join(split, 'package.json'),
        json({ name: 'split', packageManager: 'pnpm@10.0.0' }),
      );
      await write(
        join(split, 'apps/front/package.json'),
        json({
          name: 'front',
          packageManager: 'pnpm@10.0.0',
          dependencies: { react: '^19.0.0' },
        }),
      );
      await write(
        join(split, 'apps/broken/package.json'),
        json({ name: 'broken' }),
      );
      await write(join(split, 'node_modules/x/package.json'), json({}));
      await write(join(split, 'apps/agent/Agent/Agent.csproj'), '<Project />');
      await mkdir(join(split, 'apps/empty/src'), { recursive: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/outdated',
        payload: { path: split },
      });
      assert.equal(response.statusCode, 200);
      const body = OutdatedResponse.parse(response.json());
      assert.deepEqual(
        body.workspaces.map(
          ({
            path,
            standalone,
            technology,
            packageManager,
            packages,
            error,
          }) => [
            path,
            standalone,
            technology,
            packageManager,
            packages.map(({ name, status }) => [name, status]),
            error !== null,
          ],
        ),
        [
          ['apps/agent', true, 'C# / .NET', null, [], false],
          ['apps/broken', true, null, null, [], true],
          ['apps/front', true, null, 'pnpm', [['react', 'outdated']], false],
        ],
      );
    },
  );

  await t.test('validates workspace paths of package.json reads', async () => {
    assert.equal(isWorkspacePath('apps/web'), true);
    for (const path of ['../x', '/etc', 'a//b', 'a/..', './a', 'a\\b'])
      assert.equal(isWorkspacePath(path), false, path);
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/package?${new URLSearchParams({ path: repo, workspace: '../x' })}`,
    });
    assert.equal(response.statusCode, 400);
  });
});
