import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getOutdatedDependencies } from '../src/services/packages/outdated.service.js';
import {
  isPrivatePackage,
  readPrivateScopes,
} from '../src/services/packages/package-inventory.service.js';
import { getRepositoryToolchain } from '../src/services/packages/toolchain.service.js';

test('private packages, full inventory and toolchain', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-inventory-'));
  const repository = join(root, 'repository');
  const bin = join(root, 'bin');
  const previousPath = process.env.PATH;
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(bin);
  await mkdir(repository);
  const write = (path: string, content: unknown) =>
    writeFile(
      join(repository, path),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  const install = async (name: string, version: string) => {
    await mkdir(join(repository, 'node_modules', name), { recursive: true });
    await write(join('node_modules', name, 'package.json'), { name, version });
  };
  await write('package.json', {
    packageManager: 'npm@11.4.2+sha512.abc',
    engines: { node: '>=20' },
    dependencies: { '@eas/client': '^1.0.0', react: '^19.0.0' },
    devDependencies: { typescript: '^5.0.0' },
  });
  await write(
    '.npmrc',
    '@eas:registry=https://nexus.example.invalid:8443/npm/\n@pub:registry=https://registry.npmjs.org/\n',
  );
  await write('.nvmrc', 'v22.21.1\n');
  await install('@eas/client', '1.2.0');
  await install('react', '19.1.0');
  await install('typescript', '5.9.2');
  await writeFile(
    join(bin, 'npm'),
    `#!/bin/sh
echo "$@" > "${join(root, 'args.txt')}"
printf '%s' '{"react":{"current":"19.1.0","wanted":"19.2.0","latest":"20.0.0"}}'
exit 1
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${previousPath ?? ''}`;

  await t.test(
    'detects private scopes from project and user npmrc',
    async () => {
      const home = join(root, 'home');
      await mkdir(home);
      await writeFile(
        join(home, '.npmrc'),
        '@corp:registry=https://npm.corp.invalid/\n',
      );
      const scopes = await readPrivateScopes(repository, home);
      assert.deepEqual([...scopes].sort(), ['@corp', '@eas']);
      assert.ok(isPrivatePackage('@eas/client', scopes));
      assert.ok(!isPrivatePackage('@pub/tool', scopes));
      assert.ok(!isPrivatePackage('react', scopes));
    },
  );

  await t.test(
    'skips private packages and lists every root package',
    async () => {
      const result = await getOutdatedDependencies(repository);
      assert.equal(result.error, null);
      const { readFile } = await import('node:fs/promises');
      assert.equal(
        (await readFile(join(root, 'args.txt'), 'utf8')).trim(),
        'outdated --json --ignore-scripts react typescript',
      );
      assert.ok('packages' in result);
      assert.deepEqual(result.packages, [
        {
          name: '@eas/client',
          section: 'dependencies',
          declared: '^1.0.0',
          installed: '1.2.0',
          wanted: null,
          latest: null,
          status: 'private',
        },
        {
          name: 'react',
          section: 'dependencies',
          declared: '^19.0.0',
          installed: '19.1.0',
          wanted: '19.2.0',
          latest: '20.0.0',
          status: 'outdated',
        },
        {
          name: 'typescript',
          section: 'devDependencies',
          declared: '^5.0.0',
          installed: '5.9.2',
          wanted: '5.9.2',
          latest: '5.9.2',
          status: 'current',
        },
      ]);
    },
  );

  await t.test('reads declared Node and package manager versions', async () => {
    assert.deepEqual(await getRepositoryToolchain(repository, 'npm'), {
      node: { version: 'v22.21.1', source: '.nvmrc' },
      packageManager: { version: '11.4.2', source: 'packageManager' },
    });
    await rm(join(repository, '.nvmrc'));
    await write('package.json', {
      engines: { node: '>=20', npm: '>=10' },
    });
    assert.deepEqual(await getRepositoryToolchain(repository, 'npm'), {
      node: { version: '>=20', source: 'engines' },
      packageManager: { version: '>=10', source: 'engines' },
    });
  });
});
