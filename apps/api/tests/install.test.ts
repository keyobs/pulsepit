import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ErrorResponse, InstallResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { installDependencies } from '../src/services/packages/install.service.js';

async function setup(t: test.TestContext, script: string) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-install-'));
  const projects = join(root, 'projects');
  const path = join(projects, 'app');
  const bin = join(root, 'bin');
  await mkdir(join(path, '.git'), { recursive: true });
  await mkdir(bin);
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ packageManager: 'npm@11.0.0' }),
  );
  await writeFile(join(bin, 'npm'), `#!/bin/sh\n${script}\n`);
  await chmod(join(bin, 'npm'), 0o755);
  const previousPath = process.env.PATH;
  // Fake npm only: no real install or registry access.
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  });
  const install = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/repositories/install', payload });
  return { root, path, install };
}

test('install runs the detected package manager in the repository', async (t) => {
  const { path, install } = await setup(t, 'echo "$PWD $@" > args.txt');
  const response = await install({ path: `${path}/.` });
  assert.equal(response.statusCode, 200);
  const body = InstallResponse.parse(response.json());
  assert.equal(body.path, path);
  assert.equal(body.packageManager, 'npm');
  assert.equal(body.command, 'npm install --no-audit --no-fund');
  assert.equal(
    (await readFile(join(path, 'args.txt'), 'utf8')).trim(),
    `${path} install --no-audit --no-fund`,
  );
});

test('install failures keep the repository path and a short detail', async (t) => {
  const { path, install } = await setup(
    t,
    'echo "npm error code ERESOLVE" >&2\necho "npm error A complete log of this run can be found in: /x" >&2\nexit 1',
  );
  const response = await install({ path });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().path, path);
  assert.deepEqual(ErrorResponse.parse(response.json()), {
    code: 'INSTALL_FAILED',
    error: 'npm install failed: npm error code ERESOLVE',
  });
});

test('install rejects concurrent runs, missing managers and unknown repositories', async (t) => {
  const { root, path, install } = await setup(t, 'sleep 1');
  const [first, second] = await Promise.all([
    install({ path }),
    new Promise((resolve) => setTimeout(resolve, 100)).then(() =>
      install({ path }),
    ),
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 409);
  assert.equal(ErrorResponse.parse(second.json()).code, 'INSTALL_RUNNING');

  await rm(join(path, 'package.json'));
  const noManager = await install({ path });
  assert.equal(noManager.statusCode, 422);
  assert.equal(ErrorResponse.parse(noManager.json()).code, 'PACKAGE_MANAGER');

  for (const [payload, status] of [
    [{}, 400],
    [{ path: root }, 404],
  ] as const) {
    const response = await install(payload);
    assert.equal(response.statusCode, status);
    assert.equal(Object.hasOwn(response.json(), 'path'), false);
  }
});

test('install is killed after its timeout', async (t) => {
  const { path } = await setup(t, 'sleep 5');
  const result = await installDependencies(path, 200);
  assert.ok(!('success' in result));
  assert.equal(result.code, 'TIMEOUT');
});
