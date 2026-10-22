import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import {
  ErrorResponse,
  ListRepositoriesResponse,
  Repository,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import type { RepositoryUrls } from '../src/services/repositories/repository-config.service.js';

const execute = promisify(execFile);
const detailUrl = (path: string) =>
  `/api/repositories/detail?${new URLSearchParams({ path })}`;

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function repository(projects: string, name: string) {
  const path = join(projects, name);
  await execute('git', ['init', '--initial-branch=main', path]);
  return path;
}

async function commit(path: string) {
  await git(
    path,
    '-c',
    'user.name=Detail Test',
    '-c',
    'user.email=detail@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial commit',
  );
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-repository-detail-'));
  const projects = join(root, 'projects');
  await mkdir(projects);
  const urls: RepositoryUrls = {};
  const hosting: RepositoryUrls = {};
  const app = buildApp({ port: 3001, scanPaths: [projects] }, urls, hosting);
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, projects, app, urls, hosting };
}

test('detail matches its list entry including deployment links and only inspects the requested repository', async (t) => {
  const { root, projects, app, urls, hosting } = await fixture(t);
  const selected = await repository(projects, 'repository with spaces');
  await repository(projects, 'sibling');
  await writeFile(
    join(selected, 'package.json'),
    JSON.stringify({
      name: 'selected',
      version: '1.2.3',
      packageManager: 'pnpm@12.14.0',
      engines: { node: '>=22' },
    }),
  );
  await git(selected, 'add', 'package.json');
  await commit(selected);
  await git(selected, 'branch', 'develop');
  await git(
    selected,
    'remote',
    'add',
    'origin',
    'https://example.invalid/project.git',
  );
  await git(selected, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
  urls[selected] = { production: 'https://project.example.invalid' };
  hosting[selected] = { production: 'https://console.example.invalid/project' };

  const list = await app.inject({ method: 'GET', url: '/api/repositories' });
  assert.equal(list.statusCode, 200);
  const expected = ListRepositoriesResponse.parse(
    list.json(),
  ).repositories.find((repo) => repo.path === selected);
  assert.ok(expected);

  // Record real Git subprocess working directories for this request only.
  const realGit = (
    await execute('/bin/sh', ['-c', 'command -v git'])
  ).stdout.trim();
  const bin = join(root, 'bin');
  const log = join(root, 'git-directories.jsonl');
  await mkdir(bin);
  await writeFile(
    join(bin, 'git'),
    `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.cwd()) + '\\n');
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  try {
    const response = await app.inject({
      method: 'GET',
      url: detailUrl(`${selected}/.`),
    });
    assert.equal(response.statusCode, 200);
    const parsed = Repository.parse(response.json());
    assert.deepEqual(parsed, response.json());
    assert.deepEqual(parsed, expected);
    assert.deepEqual(parsed.urls, urls[selected]);
    assert.deepEqual(parsed.hosting, hosting[selected]);
    const directories = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(directories.length > 0);
    assert.deepEqual([...new Set(directories)], [selected]);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});

test('detail rejects invalid queries and repositories outside the configured direct-child scope', async (t) => {
  const { root, projects, app } = await fixture(t);
  const selected = await repository(projects, 'selected');
  const nested = join(selected, 'nested');
  const outside = join(root, 'outside');
  const plain = join(projects, 'plain');
  const link = join(projects, 'linked');
  await mkdir(join(nested, '.git'), { recursive: true });
  await mkdir(join(outside, '.git'), { recursive: true });
  await mkdir(plain);
  await symlink(outside, link, 'dir');

  for (const url of [
    '/api/repositories/detail',
    detailUrl(''),
    detailUrl('   '),
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400);
    assert.equal(
      ErrorResponse.parse(response.json()).code,
      'FST_ERR_VALIDATION',
    );
  }
  for (const path of [
    projects,
    outside,
    nested,
    plain,
    link,
    join(projects, 'missing'),
  ]) {
    const response = await app.inject({ method: 'GET', url: detailUrl(path) });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(ErrorResponse.parse(response.json()), {
      error: 'Repository not found in configured scan directories.',
    });
  }
});

test('detail supports worktrees and preserves partial Git errors with default deployment maps', async (t) => {
  const { projects, app } = await fixture(t);
  const primary = await repository(projects, 'primary');
  await commit(primary);
  const worktree = join(projects, 'worktree');
  await git(
    primary,
    'worktree',
    'add',
    '-b',
    'feature/detail',
    worktree,
    'main',
  );
  const response = await app.inject({
    method: 'GET',
    url: detailUrl(worktree),
  });
  assert.equal(response.statusCode, 200);
  const parsed = Repository.parse(response.json());
  assert.equal(parsed.path, worktree);
  assert.equal(parsed.git?.branch, 'feature/detail');
  assert.deepEqual(parsed.urls, {});
  assert.deepEqual(parsed.hosting, {});

  const broken = join(projects, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });
  const partial = await app.inject({ method: 'GET', url: detailUrl(broken) });
  assert.equal(partial.statusCode, 200);
  const result = Repository.parse(partial.json());
  assert.equal(result.path, broken);
  assert.equal(result.git, null);
  assert.equal(
    result.gitError,
    'Unable to read Git status for this repository.',
  );
  assert.equal(result.sync, null);
  assert.equal(result.developLastCommitAt, null);
  assert.equal(result.origin, null);
  assert.equal(typeof result.originError, 'string');
  assert.equal(result.versions.head.version, null);
  assert.equal(typeof result.versions.head.error, 'string');
});
