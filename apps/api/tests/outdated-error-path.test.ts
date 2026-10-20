import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ErrorResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

test('outdated errors include a normalized path only after the repository has been identified', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-outdated-error-path-'));
  const projects = join(root, 'projects');
  const path = join(projects, 'repository with spaces');
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(path, '.git'), { recursive: true });
  const payload = { path: `${path}/.` };

  const noManager = await app.inject({
    method: 'POST',
    url: '/api/repositories/outdated',
    payload,
  });
  assert.equal(noManager.statusCode, 422);
  assert.equal(noManager.json().path, path);
  assert.equal(ErrorResponse.parse(noManager.json()).code, 'PACKAGE_MANAGER');

  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ packageManager: 'npm@11.0.0' }),
  );
  const previousPath = process.env.PATH;
  // An isolated, empty executable search path prevents any real npm invocation.
  process.env.PATH = root;
  try {
    const missingExecutable = await app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload,
    });
    assert.equal(missingExecutable.statusCode, 502);
    assert.equal(missingExecutable.json().path, path);
    assert.deepEqual(ErrorResponse.parse(missingExecutable.json()), {
      code: 'COMMAND_FAILED',
      error: 'npm executable was not found in PATH.',
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }

  for (const [body, status] of [
    [{}, 400],
    [{ path: root }, 404],
  ] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: body,
    });
    assert.equal(response.statusCode, status);
    assert.equal(Object.hasOwn(response.json(), 'path'), false);
    assert.equal(typeof ErrorResponse.parse(response.json()).error, 'string');
  }
});
