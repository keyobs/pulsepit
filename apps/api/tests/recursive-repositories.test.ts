import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  ErrorResponse,
  ListRepositoriesResponse,
  PackageResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { findConfiguredRepository } from '../src/services/repositories.service.js';

const execute = promisify(execFile);

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-recursive-'));
  const scan = join(root, 'projects');
  await mkdir(scan);
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) =>
    execute(
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
      { cwd },
    );
  const repository = join(scan, 'clients', 'acme', 'project');
  await mkdir(repository, { recursive: true });
  await git(repository, 'init', '--initial-branch=main');
  await writeFile(
    join(repository, 'package.json'),
    '{"name":"nested","version":"1.0.0"}',
  );
  await git(repository, 'add', 'package.json');
  await git(repository, 'commit', '--no-gpg-sign', '-m', 'Initial manifest');
  const fakeRepository = async (path: string) => {
    await mkdir(join(path, '.git'), { recursive: true });
    return path;
  };
  return { root, scan, repository, git, fakeRepository };
}

test('recursive list discovers grouped repositories and worktrees once across overlapping scan roots', async (t) => {
  const { root, scan, repository, git, fakeRepository } = await fixture(t);
  const group = join(scan, 'clients');
  const worktree = join(group, 'preview');
  await git(repository, 'worktree', 'add', '-b', 'preview', worktree);
  const sameName = await fakeRepository(join(scan, 'personal', 'project'));
  await fakeRepository(join(repository, 'embedded'));
  await fakeRepository(join(scan, 'node_modules', 'ignored'));
  await fakeRepository(join(scan, '.git', 'ignored'));
  await symlink(group, join(scan, 'shortcut'), 'dir');
  await symlink(scan, join(scan, 'loop'), 'dir');
  const missing = join(root, 'missing');
  const scanPaths = [scan, group, `${scan}/.`, missing];
  const app = buildApp({ port: 3001, scanPaths });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/api/repositories',
  });
  assert.equal(response.statusCode, 200);
  const parsed = ListRepositoriesResponse.parse(response.json());
  assert.deepEqual(parsed.scanPaths, [scan, group, missing]);
  assert.deepEqual(
    parsed.repositories.map((repo) => repo.path).sort(),
    [repository, worktree, sameName].sort(),
  );
  assert.equal(
    parsed.repositories.filter((repo) => repo.name === 'project').length,
    2,
  );
  assert.deepEqual(parsed.scanErrors, [
    { path: missing, code: 'ENOENT', message: 'Directory does not exist.' },
  ]);
  for (const path of [repository, worktree, sameName]) {
    assert.equal(
      (await findConfiguredRepository(`${path}/.`, scanPaths))?.path,
      path,
    );
  }
});

test('recursive lookup rejects symlink ancestors, excluded directories and paths outside its scan roots', async (t) => {
  const { root, scan, repository, fakeRepository } = await fixture(t);
  const outside = await fakeRepository(join(root, 'outside', 'project'));
  const prefixSibling = await fakeRepository(
    join(`${scan}-other`, 'group', 'project'),
  );
  const embedded = await fakeRepository(join(repository, 'embedded'));
  const dependency = await fakeRepository(
    join(scan, 'group', 'node_modules', 'dependency'),
  );
  const gitInternal = await fakeRepository(join(scan, '.git', 'internal'));
  await symlink(join(root, 'outside'), join(scan, 'escape'), 'dir');
  await symlink(join(scan, 'clients'), join(scan, 'alias'), 'dir');
  await symlink(repository, join(scan, 'linked-repo'), 'dir');
  const linkedMarker = join(scan, 'group', 'linked-marker');
  await mkdir(linkedMarker, { recursive: true });
  await symlink(join(repository, '.git'), join(linkedMarker, '.git'), 'dir');
  const app = buildApp({ port: 3001, scanPaths: [scan] });
  t.after(() => app.close());
  for (const path of [
    outside,
    prefixSibling,
    embedded,
    dependency,
    gitInternal,
    linkedMarker,
    join(scan, 'escape', 'project'),
    join(scan, 'alias', 'acme', 'project'),
    join(scan, 'linked-repo'),
    scan,
    join(scan, '..', 'outside', 'project'),
  ]) {
    assert.equal(await findConfiguredRepository(path, [scan]), null, path);
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/package?${new URLSearchParams({ path })}`,
    });
    assert.equal(response.statusCode, 404, path);
    assert.ok(ErrorResponse.parse(response.json()).error);
  }
  // An explicitly configured nested root is a new discovery starting point.
  assert.equal(
    (await findConfiguredRepository(embedded, [repository]))?.path,
    embedded,
  );
});

test('targeted package and diagnostic routes accept a deeply discovered repository', async (t) => {
  const { scan, repository } = await fixture(t);
  const app = buildApp({ port: 3001, scanPaths: [scan] });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: `/api/repositories/package?${new URLSearchParams({ path: `${repository}/.` })}`,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(PackageResponse.parse(response.json()), {
    path: repository,
    ref: 'head',
    manifest: { name: 'nested', version: '1.0.0' },
  });
  // No package manager is declared: reaching this error proves lookup succeeded,
  // without executing a package manager or contacting a registry.
  const diagnostic = await app.inject({
    method: 'POST',
    url: '/api/repositories/outdated',
    payload: { path: repository },
  });
  assert.equal(diagnostic.statusCode, 422);
  assert.equal(ErrorResponse.parse(diagnostic.json()).code, 'PACKAGE_MANAGER');
  assert.equal(diagnostic.json().path, repository);
});
