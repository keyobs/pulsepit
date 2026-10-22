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
import { inspectRepositoryHooks } from '../src/services/git-hooks.service.js';

const execute = promisify(execFile);

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-hook-discovery-'));
  const path = join(root, 'project');
  await execute('git', ['init', '--initial-branch=main', path]);
  const git = async (...args: string[]) =>
    (await execute('git', args, { cwd: path })).stdout.trim();
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, path, git };
}

test('discovers default hooks and their permissions without executing them or returning their contents', async (t) => {
  const { root, path, git } = await fixture(t);
  const directory = join(path, '.git/hooks');
  const sentinel = join(root, 'must-not-run');
  await writeFile(
    join(directory, 'pre-push'),
    `#!/bin/sh\ntouch '${sentinel}'\necho private-hook-token\n`,
    { mode: 0o755 },
  );
  await writeFile(join(directory, 'pre-commit'), '#!/bin/sh\nexit 1\n', {
    mode: 0o644,
  });
  const config = await readFile(join(path, '.git/config'), 'utf8');
  const result = await inspectRepositoryHooks(path);
  assert.equal(result.error, null);
  assert.equal(result.directory, directory);
  assert.equal(result.source, 'default');
  assert.equal(result.directoryState, 'directory');
  assert.deepEqual(
    result.hooks.map(({ name, file, husky }) => [name, file.state, husky]),
    [
      ['pre-commit', 'not_executable', null],
      ['commit-msg', 'missing', null],
      ['pre-push', 'executable', null],
    ],
  );
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
  assert.equal(JSON.stringify(result).includes('private-hook-token'), false);
  assert.equal(await readFile(join(path, '.git/config'), 'utf8'), config);
  assert.equal(await git('symbolic-ref', '--short', 'HEAD'), 'main');
});

test('resolves relative, absolute and shared worktree hook paths through Git', async (t) => {
  const { root, path, git } = await fixture(t);
  const relative = 'custom hooks';
  await mkdir(join(path, relative));
  await git('config', 'core.hooksPath', relative);
  assert.equal(
    (await inspectRepositoryHooks(path)).directory,
    join(path, relative),
  );
  const absolute = join(root, 'shared hooks');
  await mkdir(absolute);
  await writeFile(join(absolute, 'pre-push'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  });
  await git('config', 'core.hooksPath', absolute);
  await git(
    '-c',
    'user.name=Hook Discovery',
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
  const worktree = join(root, 'worktree');
  await git('worktree', 'add', '--detach', worktree);
  const result = await inspectRepositoryHooks(worktree);
  assert.equal(result.directory, absolute);
  assert.equal(result.source, 'configured');
  assert.equal(
    result.hooks.find((hook) => hook.name === 'pre-push')?.file.state,
    'executable',
  );
  await git('config', '--unset', 'core.hooksPath');
  assert.equal(
    (await inspectRepositoryHooks(worktree)).directory,
    join(path, '.git/hooks'),
  );
});

test('recognizes standard Husky wrappers while keeping script permissions and missing scripts distinct', async (t) => {
  const { root, path, git } = await fixture(t);
  const directory = join(path, '.husky/_');
  await mkdir(directory, { recursive: true });
  await git('config', 'core.hooksPath', '.husky/_');
  const marker = join(root, 'loader-must-not-run');
  await writeFile(join(directory, 'h'), `#!/bin/sh\ntouch '${marker}'\n`, {
    mode: 0o644,
  });
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
    await writeFile(
      join(directory, name),
      '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
      { mode: 0o755 },
    );
  }
  await writeFile(
    join(path, '.husky/pre-push'),
    '#!/bin/sh\necho private-script-token\nexit 1\n',
    { mode: 0o644 },
  );
  const result = await inspectRepositoryHooks(path);
  assert.equal(result.directory, directory);
  const hook = result.hooks.find((entry) => entry.name === 'pre-push');
  assert.equal(hook?.file.state, 'executable');
  assert.deepEqual(hook?.husky, {
    loader: { path: join(directory, 'h'), state: 'not_executable' },
    script: { path: join(path, '.husky/pre-push'), state: 'not_executable' },
  });
  assert.equal(
    result.hooks.find((entry) => entry.name === 'commit-msg')?.husky?.script
      .state,
    'missing',
  );
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal(JSON.stringify(result).includes('private-script-token'), false);
  await writeFile(
    join(directory, 'pre-push'),
    `#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n${'#'.repeat(4096)}`,
  );
  assert.equal(
    (await inspectRepositoryHooks(path)).hooks.find(
      (entry) => entry.name === 'pre-push',
    )?.husky,
    null,
  );
});

test('uses user Git configuration and reports missing, disabled or unsupported hook locations conservatively', async (t) => {
  const { root, path, git } = await fixture(t);
  const global = join(root, 'gitconfig');
  const directory = join(root, 'global-hooks');
  await mkdir(directory);
  await writeFile(
    global,
    `[core]\n\thooksPath = ${JSON.stringify(directory)}\n`,
  );
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = global;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });
  const configured = await inspectRepositoryHooks(path);
  assert.equal(configured.directory, directory);
  assert.equal(configured.source, 'configured');
  await git('config', 'core.hooksPath', join(root, 'absent'));
  assert.equal((await inspectRepositoryHooks(path)).directoryState, 'missing');
  await git('config', 'core.hooksPath', '/dev/null');
  const disabled = await inspectRepositoryHooks(path);
  assert.equal(disabled.directoryState, 'not_directory');
  assert.ok(disabled.hooks.every((entry) => entry.file.state === 'missing'));
  const link = join(root, 'linked-hooks');
  await symlink(directory, link);
  await git('config', 'core.hooksPath', link);
  const resolved = await inspectRepositoryHooks(path);
  assert.equal(resolved.directory, directory);
  assert.equal(resolved.directoryState, 'directory');
  await git('config', 'core.hooksPath', directory);
  await symlink(join(root, 'unrelated-secret'), join(directory, 'pre-push'));
  assert.equal(
    (await inspectRepositoryHooks(path)).hooks.find(
      (entry) => entry.name === 'pre-push',
    )?.file.state,
    'unsupported',
  );
});

test('unreadable Git repositories return sanitized uncertainty rather than claiming hooks are absent', async (t) => {
  const { root } = await fixture(t);
  const broken = join(root, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });
  for (const path of [broken, join(root, 'missing')]) {
    const result = await inspectRepositoryHooks(path);
    assert.equal(result.error?.code, 'HOOKS_READ_FAILED');
    assert.equal(result.directory, null);
    assert.equal(result.source, null);
    assert.equal(result.directoryState, null);
    assert.deepEqual(
      result.hooks.map(({ name, file, husky }) => [
        name,
        file.path,
        file.state,
        husky,
      ]),
      [
        ['pre-commit', null, 'unsupported', null],
        ['commit-msg', null, 'unsupported', null],
        ['pre-push', null, 'unsupported', null],
      ],
    );
    assert.equal(JSON.stringify(result).includes(root), false);
  }
});
