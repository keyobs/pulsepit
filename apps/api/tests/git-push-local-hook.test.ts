import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { ErrorResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-local-hook-'));
  const path = join(root, 'project');
  const remote = join(root, 'remote.git');
  await execute('git', ['init', '--initial-branch=main', path]);
  await git(
    path,
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hook@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  await git(path, 'branch', 'develop');
  await git(root, 'clone', '--bare', path, remote);
  await git(path, 'remote', 'add', 'origin', remote);
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const push = () =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/push',
      payload: { path, branch: 'develop' },
    });
  return { path, remote, push };
}

test('a failed local Husky pre-push hook produces 422 with a specific sanitized error and preserves remote refs', async (t) => {
  const { path, remote, push } = await fixture(t);
  const previous = await git(remote, 'rev-parse', 'refs/heads/develop');
  const refs = await git(
    path,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
  );
  for (const stream of ['', ' >&2']) {
    await writeFile(
      join(path, '.git/hooks/pre-push'),
      `#!/bin/sh\necho "private-token-do-not-expose" >&2\necho "husky - pre-push script failed (code 1)"${stream}\nexit 1\n`,
      { mode: 0o755 },
    );
    const response = await push();
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().code, 'LOCAL_HOOK_FAILED');
    assert.equal(response.json().success, false);
    assert.equal(response.json().path, path);
    assert.equal(response.json().branch, 'develop');
    assert.ok(ErrorResponse.safeParse(response.json()).success);
    assert.match(response.json().error, /local pre-push hook/i);
    assert.equal(response.body.includes('private-token'), false);
    assert.equal(
      await git(remote, 'rev-parse', 'refs/heads/develop'),
      previous,
    );
    assert.equal(
      await git(path, 'for-each-ref', '--format=%(refname) %(objectname)'),
      refs,
    );
  }
});

test('server output mentioning Husky remains a remote rejection and never pretends a local hook failed', async (t) => {
  const { path, remote, push } = await fixture(t);
  await git(
    path,
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hook@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'checkout',
    'develop',
  );
  await git(
    path,
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=hook@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    'Local change',
  );
  const previous = await git(remote, 'rev-parse', 'refs/heads/develop');
  await writeFile(
    join(remote, 'hooks/pre-receive'),
    '#!/bin/sh\necho "husky - pre-push script failed (code 1)" >&2\necho "private-token-do-not-expose" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  const response = await push();
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'REMOTE_REJECTED');
  assert.equal(response.body.includes('private-token'), false);
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/develop'), previous);
});
