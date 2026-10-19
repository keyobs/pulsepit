import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

test('specific Git push errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-push-errors-'));
  const projects = join(root, 'projects');
  const repository = join(projects, 'repository');
  const remote = join(root, 'remote.git');
  await mkdir(repository, { recursive: true });
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function git(cwd: string, ...args: string[]) {
    return (await execute('git', args, { cwd })).stdout.trim();
  }
  const identity = [
    '-c',
    'user.name=Pulsepit Test',
    '-c',
    'user.email=test@example.invalid',
  ];
  await git(repository, 'init', '--initial-branch=main');
  await git(
    repository,
    ...identity,
    'commit',
    '--allow-empty',
    '-m',
    'Initial',
  );
  await git(root, 'clone', '--bare', repository, remote);
  const push = (branch = 'main') =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/push',
      payload: { path: repository, branch },
    });

  await t.test(
    'reports missing origin even when a local directory is named origin',
    async () => {
      await git(
        repository,
        'clone',
        '--bare',
        repository,
        join(repository, 'origin'),
      );
      const response = await push();
      assert.equal(response.statusCode, 422);
      assert.equal(response.json().code, 'REMOTE_NOT_FOUND');
    },
  );

  await git(repository, 'remote', 'add', 'origin', remote);
  await t.test(
    'classifies real divergent history without changing the remote',
    async () => {
      const previous = await git(remote, 'rev-parse', 'refs/heads/main');
      const tree = await git(remote, 'rev-parse', 'HEAD^{tree}');
      const next = await git(
        remote,
        ...identity,
        'commit-tree',
        tree,
        '-p',
        previous,
        '-m',
        'Remote commit',
      );
      await git(remote, 'update-ref', 'refs/heads/main', next);
      const response = await push();
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'NON_FAST_FORWARD');
      assert.equal(await git(remote, 'rev-parse', 'refs/heads/main'), next);
    },
  );

  await t.test('classifies a real server hook rejection', async () => {
    await git(repository, 'branch', 'feature');
    await writeFile(
      join(remote, 'hooks/pre-receive'),
      '#!/bin/sh\necho "policy rejected" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    const response = await push('feature');
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'REMOTE_REJECTED');
    assert.equal(
      await git(
        remote,
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/feature',
      ),
      '',
    );
  });

  await t.test(
    'classifies authentication and ambiguous failures without exposing Git output',
    async (s) => {
      const bin = join(root, 'bin');
      const fixturePath = join(root, 'failure.json');
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
const fs = require('node:fs');
const args = process.argv.slice(2);
assert.equal(process.env.LC_ALL, 'C');
if (args[0] === 'check-ref-format') assert.deepEqual(args, ['check-ref-format', 'refs/heads/main']);
else if (args[0] === 'show-ref') assert.deepEqual(args, ['show-ref', '--verify', '--quiet', 'refs/heads/main']);
else if (args[0] === 'remote') assert.deepEqual(args, ['remote', 'get-url', '--push', 'origin']);
else {
  assert.deepEqual(args, ['-c', 'remote.origin.mirror=false', 'push', '--porcelain', '--no-follow-tags', '--', 'origin', 'refs/heads/main:refs/heads/main']);
  const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));
  process.stdout.write(fixture.stdout ?? '');
  process.stderr.write(fixture.stderr);
  process.exitCode = 128;
}
`,
      );
      const previousPath = process.env.PATH;
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      s.after(() => {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      });
      for (const stderr of [
        "fatal: Authentication failed for 'https://secret-token@example.invalid/repo'",
        'git@example.invalid: Permission denied (publickey).',
        "fatal: could not read Username for 'https://example.invalid': terminal prompts disabled",
        "fatal: unable to access 'https://example.invalid/repo': The requested URL returned error: 401",
      ]) {
        await writeFile(fixturePath, JSON.stringify({ stderr }));
        const response = await push();
        // This is an upstream Git authentication problem, not API authentication.
        assert.equal(response.statusCode, 502);
        assert.equal(response.json().code, 'AUTHENTICATION_FAILED');
        assert.ok(!response.body.includes('secret-token'));
        assert.ok(!response.body.includes('example.invalid'));
      }
      for (const stderr of [
        'fatal: Could not resolve host: example.invalid',
        'fatal: repository not found',
        'remote: non-fast-forward, fetch first, remote rejected',
        'fatal: unable to access remote: The requested URL returned error: 403',
      ]) {
        await writeFile(fixturePath, JSON.stringify({ stderr }));
        const response = await push();
        assert.equal(response.statusCode, 502);
        assert.equal(response.json().code, 'PUSH_FAILED');
      }
      await writeFile(
        fixturePath,
        JSON.stringify({
          stderr: '',
          stdout:
            '!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\n',
        }),
      );
      const response = await push();
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'NON_FAST_FORWARD');
    },
  );
});
