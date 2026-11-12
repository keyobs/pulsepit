import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DirectoryListResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { listDirectories } from '../src/services/directories/directories.service.js';

test('directory listing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-dirs-'));
  await mkdir(join(root, 'beta'));
  await mkdir(join(root, 'Alpha', '.git'), { recursive: true });
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'file.txt'), '');
  await symlink(join(root, 'beta'), join(root, 'link'));
  const app = buildApp({ port: 3001, scanPaths: [] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  await t.test('lists visible subdirectories only', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/directories?${new URLSearchParams({ path: root })}`,
    });
    assert.equal(response.statusCode, 200);
    const body = DirectoryListResponse.parse(response.json());
    assert.equal(body.path, root);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.directories, [
      { name: 'Alpha', path: join(root, 'Alpha'), isGitRepo: true },
      { name: 'beta', path: join(root, 'beta'), isGitRepo: false },
    ]);
  });

  await t.test('defaults to home and stops at filesystem root', async () => {
    assert.equal((await listDirectories(undefined, root)).path, root);
    assert.equal((await listDirectories('/')).parent, null);
  });

  await t.test('maps errors to HTTP statuses', async () => {
    for (const [path, status, code] of [
      ['relative', 400, 'INVALID_PATH'],
      [join(root, 'missing'), 404, 'ENOENT'],
      [join(root, 'file.txt'), 404, 'ENOTDIR'],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/fs/directories?${new URLSearchParams({ path })}`,
      });
      assert.equal(response.statusCode, status);
      assert.equal(response.json().code, code);
    }
  });
});
