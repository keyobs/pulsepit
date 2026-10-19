import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

test('push one selected local branch to origin', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-push-'));
  const projects = join(root, 'projects');
  const repository = join(projects, 'repository with spaces');
  const remote = join(root, 'origin.git');
  await mkdir(repository, { recursive: true });
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function git(cwd: string, ...args: string[]) {
    return (await execute('git', args, { cwd })).stdout.trim();
  }
  async function commit(cwd: string, message: string) {
    await git(
      cwd,
      '-c',
      'user.name=Pulsepit Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      message,
    );
  }
  const push = (branch: string, path = repository) =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/push',
      payload: { path, branch },
    });
  await git(repository, 'init', '--initial-branch=main');
  await writeFile(join(repository, 'tracked.txt'), 'initial\n');
  await git(repository, 'add', 'tracked.txt');
  await commit(repository, 'Initial');
  await git(root, 'clone', '--bare', repository, remote);
  await git(repository, 'remote', 'add', 'origin', remote);
  const initial = await git(repository, 'rev-parse', 'HEAD');
  await git(repository, 'checkout', '-b', 'feature/example');
  await commit(repository, 'Feature');
  const feature = await git(repository, 'rev-parse', 'HEAD');
  await git(
    repository,
    '-c',
    'user.name=Pulsepit Test',
    '-c',
    'user.email=test@example.invalid',
    'tag',
    '-a',
    'private-tag',
    '-m',
    'Private tag',
  );
  await git(repository, 'branch', 'other-local-branch');
  await git(remote, 'update-ref', 'refs/heads/remote-only', initial);
  await git(repository, 'checkout', 'main');
  await writeFile(join(repository, 'tracked.txt'), 'local work\n');
  await writeFile(join(repository, 'untracked.txt'), 'local file\n');
  await git(repository, 'config', 'remote.origin.mirror', 'true');
  await git(repository, 'config', 'push.followTags', 'true');

  await t.test(
    'pushes only the selected branch without checkout, mirror or automatic tags',
    async () => {
      const before = await git(repository, 'status', '--porcelain');
      const response = await push('feature/example');
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        path: repository,
        branch: 'feature/example',
        remote: 'origin',
        success: true,
      });
      assert.equal(
        await git(remote, 'rev-parse', 'refs/heads/feature/example'),
        feature,
      );
      assert.equal(await git(remote, 'rev-parse', 'refs/heads/main'), initial);
      assert.equal(
        await git(remote, 'rev-parse', 'refs/heads/remote-only'),
        initial,
      );
      const refs = await git(remote, 'for-each-ref', '--format=%(refname)');
      assert.ok(!refs.includes('other-local-branch'));
      assert.ok(!refs.includes('private-tag'));
      assert.equal(
        await git(repository, 'symbolic-ref', '--short', 'HEAD'),
        'main',
      );
      assert.equal(await git(repository, 'status', '--porcelain'), before);
      assert.equal(
        await readFile(join(repository, 'tracked.txt'), 'utf8'),
        'local work\n',
      );
      assert.equal(
        await readFile(join(repository, 'untracked.txt'), 'utf8'),
        'local file\n',
      );
    },
  );

  await t.test(
    'rejects invalid bodies, branch names and unconfigured paths',
    async () => {
      for (const payload of [
        {},
        { path: repository },
        { path: repository, branch: '' },
        { path: repository, branch: '   ' },
      ]) {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/repositories/push',
              payload,
            })
          ).statusCode,
          400,
        );
      }
      for (const branch of [
        '--all',
        'main..other',
        'main:other',
        'main~1',
        '@{-1}',
        'HEAD',
      ]) {
        const response = await push(branch);
        assert.equal(response.statusCode, 400, branch);
        assert.equal(response.json().code, 'INVALID_BRANCH');
      }
      assert.equal((await push('main', root)).statusCode, 404);
    },
  );

  await t.test('refuses nonexistent local branches', async () => {
    const response = await push('missing');
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().code, 'BRANCH_NOT_FOUND');
  });

  await t.test(
    'refuses a non-fast-forward push without overwriting remote history',
    async () => {
      const writer = join(root, 'writer');
      await git(root, 'clone', remote, writer);
      await git(writer, 'checkout', 'feature/example');
      await commit(writer, 'Remote change');
      await git(writer, 'push', 'origin', 'feature/example');
      const remoteHead = await git(writer, 'rev-parse', 'HEAD');
      // The selected local branch still points at the earlier commit.
      const response = await push('feature/example');
      assert.equal(response.statusCode, 502);
      assert.equal(response.json().code, 'PUSH_FAILED');
      assert.equal(
        await git(remote, 'rev-parse', 'refs/heads/feature/example'),
        remoteHead,
      );
    },
  );

  await t.test('reports a missing origin remote', async () => {
    await git(repository, 'remote', 'remove', 'origin');
    const response = await push('main');
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().success, false);
    assert.equal(response.json().code, 'PUSH_FAILED');
  });

  await t.test('terminates a hung push after 30 seconds', async (r) => {
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(
      join(bin, 'git'),
      `#!/bin/sh
unset NODE_TEST_CONTEXT
exec "${process.execPath}" "${join(bin, 'git.cjs')}" "$@"
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, 'git.cjs'),
      `
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.equal(process.env.GIT_TERMINAL_PROMPT, '0');
if (args[0] === 'check-ref-format') assert.deepEqual(args, ['check-ref-format', 'refs/heads/main']);
else if (args[0] === 'show-ref') assert.deepEqual(args, ['show-ref', '--verify', '--quiet', 'refs/heads/main']);
else {
  assert.deepEqual(args, ['-c', 'remote.origin.mirror=false', 'push', '--porcelain', '--no-follow-tags', '--', 'origin', 'refs/heads/main:refs/heads/main']);
  setInterval(() => {}, 1000);
}
`,
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ''}`;
    r.after(() => {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    });
    const response = await push('main');
    assert.equal(response.statusCode, 504);
    assert.equal(response.json().code, 'TIMEOUT');
  });
});
