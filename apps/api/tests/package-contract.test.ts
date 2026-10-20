import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ErrorResponse, PackageResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const exec = promisify(execFile);
const packageUrl = (path: string, ref?: string) =>
  `/api/repositories/package?${new URLSearchParams({
    path,
    ...(ref === undefined ? {} : { ref }),
  })}`;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-package-contract-'));
  const path = join(root, 'project');
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path);
  const git = (...args: string[]) =>
    exec(
      'git',
      [
        '-c',
        'user.name=Contract tests',
        '-c',
        'user.email=tests@example.invalid',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd: path },
    );
  await git('init', '--initial-branch=main');
  const commitManifest = async (content: string) => {
    await writeFile(join(path, 'package.json'), content);
    await git('add', 'package.json');
    await git('commit', '--no-gpg-sign', '-m', 'Update test manifest');
  };
  return { root, path, app, git, commitManifest };
}

test('shared package contract preserves committed manifests for head, main and develop', async (t) => {
  const { path, app, git, commitManifest } = await fixture(t);
  const manifest = (version: string) => ({
    name: 'project',
    version,
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    custom: { enabled: false, options: [null, 42, { label: 'nested' }] },
  });
  await commitManifest(JSON.stringify(manifest('1.0.0')));
  await git('checkout', '-b', 'develop');
  await commitManifest(JSON.stringify(manifest('2.0.0')));
  await git('checkout', '-b', 'feature');
  await commitManifest(JSON.stringify(manifest('3.0.0')));
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify(manifest('4.0.0')),
  );

  for (const [ref, version] of [
    [undefined, '3.0.0'],
    ['head', '3.0.0'],
    ['main', '1.0.0'],
    ['develop', '2.0.0'],
  ] as const) {
    const response = await app.inject({
      method: 'GET',
      url: packageUrl(`${path}/.`, ref),
    });
    assert.equal(response.statusCode, 200);
    const expected = { path, ref: ref ?? 'head', manifest: manifest(version) };
    assert.deepEqual(response.json(), expected);
    assert.deepEqual(PackageResponse.parse(response.json()), expected);
  }
});

test('shared package contract separates invalid requests, missing refs and invalid manifests from success', async (t) => {
  const { root, path, app, git, commitManifest } = await fixture(t);
  await commitManifest('{"name":"project","version":"1.0.0"}');
  for (const [url, status] of [
    ['/api/repositories/package', 400],
    [packageUrl(path, 'origin/main'), 400],
    [packageUrl(root), 404],
    [packageUrl(path, 'develop'), 422],
  ] as const) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, status);
    assert.equal(typeof ErrorResponse.parse(response.json()).error, 'string');
    assert.equal(PackageResponse.safeParse(response.json()).success, false);
  }

  await git('checkout', '-b', 'invalid-manifest');
  for (const content of ['{ invalid JSON', '[]']) {
    await commitManifest(content);
    const response = await app.inject({ method: 'GET', url: packageUrl(path) });
    assert.equal(response.statusCode, 422);
    assert.equal(typeof ErrorResponse.parse(response.json()).error, 'string');
    assert.equal(PackageResponse.safeParse(response.json()).success, false);
  }
  for (const invalid of [
    { path, ref: 'head', manifest: [] },
    { path, ref: 'main', manifest: null },
    { path, ref: 'origin/main', manifest: {} },
    { path, manifest: {} },
  ]) {
    assert.equal(PackageResponse.safeParse(invalid).success, false);
  }
});
