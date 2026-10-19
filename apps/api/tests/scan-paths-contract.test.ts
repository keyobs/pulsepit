import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { ListRepositoriesResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

test('repository list exposes normalized unique scan paths even for empty directories', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-scan-paths-'));
  const first = join(root, 'first');
  const second = join(root, 'second');
  const app = buildApp({
    port: 3001,
    scanPaths: [relative(process.cwd(), first), second, `${first}/.`, second],
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(first);
  await mkdir(second);

  const response = await app.inject({
    method: 'GET',
    url: '/api/repositories',
  });
  assert.equal(response.statusCode, 200);
  const parsed = ListRepositoriesResponse.parse(response.json());
  assert.deepEqual(parsed, {
    scanPaths: [first, second],
    repositories: [],
    scanErrors: [],
  });
  assert.deepEqual(response.json(), parsed);
});

test('repository list keeps failed scan paths alongside their errors in the shared contract', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-scan-path-errors-'));
  const empty = join(root, 'empty');
  const missing = join(root, 'missing');
  const file = join(root, 'file');
  const scanPaths = [empty, missing, file];
  const app = buildApp({ port: 3001, scanPaths });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(empty);
  await writeFile(file, 'This is not a directory.');

  const response = await app.inject({
    method: 'GET',
    url: '/api/repositories',
  });
  assert.equal(response.statusCode, 200);
  const parsed = ListRepositoriesResponse.parse(response.json());
  assert.deepEqual(parsed.scanPaths, scanPaths);
  assert.deepEqual(parsed.repositories, []);
  assert.deepEqual(parsed.scanErrors, [
    { path: missing, code: 'ENOENT', message: 'Directory does not exist.' },
    { path: file, code: 'ENOTDIR', message: 'Scan path is not a directory.' },
  ]);
  assert.equal(
    ListRepositoriesResponse.safeParse({ ...parsed, scanPaths: undefined })
      .success,
    false,
  );
});
