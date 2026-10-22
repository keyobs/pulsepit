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
import { ErrorResponse, RepositoryHooksResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);
const names = ['pre-commit', 'commit-msg', 'pre-push'] as const;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-hooks-http-'));
  const scan = join(root, 'projects');
  const path = join(scan, 'group', 'project');
  await mkdir(join(scan, 'group'), { recursive: true });
  await execute('git', ['init', '--initial-branch=main', path]);
  const app = buildApp({ port: 3001, scanPaths: [scan] });
  const calls = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected remote request.');
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const git = async (...args: string[]) =>
    (await execute('git', args, { cwd: path })).stdout.trim();
  const read = (repository = path) =>
    app.inject({
      method: 'GET',
      url: `/api/repositories/hooks?${new URLSearchParams({ path: repository })}`,
    });
  return { root, scan, path, app, git, read, calls };
}

test('HTTP hook inventory exposes default and custom locations without executing hooks or changing repository responses', async (t) => {
  const { root, path, app, git, read, calls } = await fixture(t);
  const directory = join(path, '.git/hooks');
  const marker = join(root, 'must-not-run');
  await writeFile(
    join(directory, 'pre-commit'),
    `#!/bin/sh\ntouch '${marker}'\necho private-hook-token\n`,
    { mode: 0o755 },
  );
  await writeFile(join(directory, 'commit-msg'), '#!/bin/sh\nexit 1\n', {
    mode: 0o644,
  });
  const before = await readFile(join(path, '.git/config'), 'utf8');
  const response = await read(`${path}/.`);
  assert.equal(response.statusCode, 200);
  const parsed = RepositoryHooksResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  assert.equal(parsed.source, 'default');
  assert.equal(parsed.directory, directory);
  assert.equal(parsed.directoryState, 'directory');
  assert.equal(parsed.error, null);
  assert.deepEqual(
    parsed.hooks.map((hook) => [hook.name, hook.file.state, hook.husky]),
    [
      ['pre-commit', 'executable', null],
      ['commit-msg', 'not_executable', null],
      ['pre-push', 'missing', null],
    ],
  );
  for (const url of [
    '/api/repositories',
    `/api/repositories/detail?${new URLSearchParams({ path })}`,
  ]) {
    const repositoryResponse = await app.inject({ method: 'GET', url });
    assert.equal(repositoryResponse.statusCode, 200);
    const repository = url.includes('/detail?')
      ? repositoryResponse.json()
      : repositoryResponse.json().repositories[0];
    assert.equal(Object.hasOwn(repository, 'hooks'), false);
  }
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(response.body.includes('private-hook-token'), false);
  assert.equal(await readFile(join(path, '.git/config'), 'utf8'), before);
  const custom = join(path, 'custom hooks');
  await mkdir(custom);
  await git('config', 'core.hooksPath', 'custom hooks');
  const updated = RepositoryHooksResponse.parse((await read()).json());
  assert.equal(updated.source, 'configured');
  assert.equal(updated.directory, custom);
  assert.ok(updated.hooks.every((hook) => hook.file.state === 'missing'));
  assert.equal(calls.mock.calls.length, 0);
});

test('HTTP Husky inventory describes wrapper, loader and source permissions consistently in linked worktrees', async (t) => {
  const { root, path, git, read, calls } = await fixture(t);
  const directory = join(path, '.husky/_');
  await mkdir(directory, { recursive: true });
  const marker = join(root, 'husky-must-not-run');
  await writeFile(join(directory, 'h'), `#!/bin/sh\ntouch '${marker}'\n`, {
    mode: 0o644,
  });
  for (const name of names)
    await writeFile(
      join(directory, name),
      '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
      { mode: 0o755 },
    );
  await writeFile(
    join(path, '.husky/pre-push'),
    '#!/bin/sh\necho private-script-token\n',
    { mode: 0o644 },
  );
  await git(
    '-c',
    'user.name=Hooks Route',
    '-c',
    'user.email=hooks@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  await git('config', 'core.hooksPath', directory);
  const linked = join(root, 'projects', 'linked');
  await git('worktree', 'add', '--detach', linked);
  const response = await read(linked);
  assert.equal(response.statusCode, 200);
  const parsed = RepositoryHooksResponse.parse(response.json());
  assert.equal(parsed.path, linked);
  assert.equal(parsed.directory, directory);
  assert.deepEqual(
    parsed.hooks.map((hook) => hook.name),
    names,
  );
  assert.deepEqual(parsed.hooks[2].husky, {
    loader: { path: join(directory, 'h'), state: 'not_executable' },
    script: { path: join(path, '.husky/pre-push'), state: 'not_executable' },
  });
  assert.equal(parsed.hooks[1].husky?.script.state, 'missing');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(response.body.includes('private-script-token'), false);
  assert.equal(calls.mock.calls.length, 0);
});

test('invalid requests and repositories outside the configured scan scope return shared errors without network access', async (t) => {
  const { root, scan, path, app, calls } = await fixture(t);
  const outside = join(root, 'outside');
  await execute('git', ['init', '--initial-branch=main', outside]);
  const link = join(scan, 'alias');
  await symlink(outside, link);
  const nested = join(path, 'nested');
  await execute('git', ['init', '--initial-branch=main', nested]);
  for (const [url, expected] of [
    ['/api/repositories/hooks', 400],
    ['/api/repositories/hooks?path=%20', 400],
    ...[
      scan,
      outside,
      link,
      nested,
      join(scan, 'missing'),
      join(outside, '..', 'outside'),
    ].map((repository) => [
      `/api/repositories/hooks?${new URLSearchParams({ path: repository })}`,
      404,
    ]),
  ] as [string, number][]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, expected);
    assert.ok(ErrorResponse.safeParse(response.json()).success);
    assert.equal(Object.hasOwn(response.json(), 'hooks'), false);
  }
  assert.equal(calls.mock.calls.length, 0);
});

test('Git failures and timeouts preserve three unknown hook entries with sanitized partial errors', async (t) => {
  const { root, scan, read, calls } = await fixture(t);
  const broken = join(scan, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });
  const failure = await read(broken);
  assert.equal(failure.statusCode, 200);
  const parsed = RepositoryHooksResponse.parse(failure.json());
  assert.equal(parsed.error?.code, 'HOOKS_READ_FAILED');
  assert.equal(parsed.directory, null);
  assert.equal(parsed.source, null);
  assert.equal(parsed.directoryState, null);
  assert.deepEqual(
    parsed.hooks.map((hook) => [
      hook.name,
      hook.file.path,
      hook.file.state,
      hook.husky,
    ]),
    names.map((name) => [name, null, 'unsupported', null]),
  );
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'git'),
    `#!${process.execPath}\nprocess.stderr.write('private-process-token');\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
  const timeout = await read();
  assert.equal(timeout.statusCode, 200);
  const timedOut = RepositoryHooksResponse.parse(timeout.json());
  assert.equal(timedOut.error?.code, 'TIMEOUT');
  assert.deepEqual(timedOut.hooks, parsed.hooks);
  assert.equal(timeout.body.includes('private-process-token'), false);
  assert.equal(calls.mock.calls.length, 0);
});

test('shared hook contracts reject unstable order, missing fields and contradictory uncertainty', () => {
  const response = {
    path: '/projects/project',
    directory: null,
    source: null,
    directoryState: null,
    hooks: names.map((name) => ({
      name,
      file: { path: null, state: 'unsupported' },
      husky: null,
    })),
    error: {
      code: 'HOOKS_READ_FAILED',
      message: 'Unable to inspect Git hooks for this repository.',
    },
  };
  assert.equal(RepositoryHooksResponse.safeParse(response).success, true);
  for (const invalid of [
    { ...response, hooks: [] },
    { ...response, hooks: response.hooks.slice(0, 2) },
    { ...response, hooks: [...response.hooks].reverse() },
    {
      ...response,
      hooks: [response.hooks[0], response.hooks[0], response.hooks[2]],
    },
    { ...response, source: 'invalid' },
    { ...response, error: { code: 'PUSH_FAILED', message: 'Invalid code.' } },
    { ...response, error: null },
    {
      ...response,
      hooks: response.hooks.map((hook) => ({
        ...hook,
        file: { path: null, state: 'missing' },
      })),
    },
    {
      ...response,
      hooks: response.hooks.map((hook) => ({
        ...hook,
        file: { path: '/invented', state: 'unsupported' },
      })),
    },
    { ...response, directory: undefined },
  ])
    assert.equal(RepositoryHooksResponse.safeParse(invalid).success, false);
});
