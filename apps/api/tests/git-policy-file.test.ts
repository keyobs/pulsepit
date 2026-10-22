import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { GitPolicyFile } from '@pulsepit/contracts';
import { readRepositoryGitPolicyFile } from '../src/services/git/git-policy-file.service.js';

const execute = promisify(execFile);
const rule = { directPush: 'forbidden', requiredChecks: [] };
const document = {
  version: 1,
  remote: 'origin',
  branches: {
    main: rule,
    develop: {
      directPush: 'allowed',
      requiredChecks: ['lint-fix', 'test-run'],
    },
  },
};
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-policy-file-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.pulsepit');
  const path = join(directory, 'git-policy.json');
  return { root, directory, path };
}

test('versioned declaration validates complete rules and rejects ambiguous or executable settings', () => {
  assert.deepEqual(GitPolicyFile.parse(document).default, {
    directPush: 'unknown',
    requiredChecks: null,
  });
  assert.deepEqual(
    GitPolicyFile.parse({ version: 1, remote: 'origin' }).branches,
    {},
  );
  for (const value of [
    { ...document, version: 2 },
    { ...document, remote: 'secondary' },
    { ...document, command: 'npm test' },
    { ...document, default: { directPush: 'allowed' } },
    { ...document, branches: { main: { ...rule, bypass: true } } },
    {
      ...document,
      branches: { main: { ...rule, requiredChecks: ['test', 'test'] } },
    },
    {
      ...document,
      branches: { main: { ...rule, requiredChecks: ['test_run'] } },
    },
  ])
    assert.equal(GitPolicyFile.safeParse(value).success, false);
});

test('fixed file is read on each call; invalid content never reuses a previous valid rule or executes repository code', async (t) => {
  const { root, directory, path } = await fixture(t);
  assert.equal((await readRepositoryGitPolicyFile(root)).state, 'missing');
  await mkdir(directory);
  assert.equal((await readRepositoryGitPolicyFile(root)).state, 'missing');
  await writeFile(path, JSON.stringify(document));
  const first = await readRepositoryGitPolicyFile(root);
  assert.equal(first.state, 'loaded');
  assert.equal(first.declaration?.branches.main.directPush, 'forbidden');
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      remote: 'origin',
      branches: { 'feature/login': rule },
    }),
  );
  assert.deepEqual(
    Object.keys(
      (await readRepositoryGitPolicyFile(root)).declaration?.branches ?? {},
    ),
    ['feature/login'],
  );
  const marker = join(root, 'executed');
  await writeFile(path, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  const invalid = await readRepositoryGitPolicyFile(root);
  assert.equal(invalid.state, 'invalid');
  assert.equal(invalid.declaration, null);
  assert.equal(invalid.error?.code, 'INVALID_PUSH_POLICY');
  assert.equal(JSON.stringify(invalid).includes(marker), false);
  await assert.rejects(access(marker));
  for (const branch of [
    'HEAD',
    '-option',
    'bad..branch',
    'main:develop',
    '__proto__',
  ]) {
    await writeFile(
      path,
      `{"version":1,"remote":"origin","branches":{${JSON.stringify(branch)}:{"directPush":"forbidden","requiredChecks":[]}}}`,
    );
    assert.equal((await readRepositoryGitPolicyFile(root)).state, 'invalid');
  }
});

test('reader rejects symlinks, nonregular files, oversized files and malformed UTF-8 with sanitized diagnostics', async (t) => {
  const { root, directory, path } = await fixture(t);
  const outside = join(root, 'external');
  await mkdir(outside);
  await writeFile(join(outside, 'git-policy.json'), JSON.stringify(document));
  await symlink(outside, directory);
  assert.equal((await readRepositoryGitPolicyFile(root)).state, 'invalid');
  await rm(directory);
  await mkdir(directory);
  await symlink(join(outside, 'git-policy.json'), path);
  assert.equal((await readRepositoryGitPolicyFile(root)).state, 'invalid');
  await rm(path);
  await mkdir(path);
  assert.equal((await readRepositoryGitPolicyFile(root)).state, 'invalid');
  await rm(path, { recursive: true });
  for (const content of [
    Buffer.alloc(65537, 32),
    Buffer.from([0xff]),
    Buffer.from('{"secret":"do-not-expose"'),
  ]) {
    await writeFile(path, content);
    const result = await readRepositoryGitPolicyFile(root);
    assert.equal(result.state, 'invalid');
    assert.equal(JSON.stringify(result).includes('do-not-expose'), false);
  }
});

test('worktree declaration is independent from its main repository and accepts an absent local branch rule', async (t) => {
  const { root, directory, path } = await fixture(t);
  await execute('git', ['init', '--initial-branch=main', root]);
  await execute(
    'git',
    [
      '-c',
      'user.name=Policy Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-m',
      'Initial',
    ],
    { cwd: root },
  );
  const worktree = join(root, 'worktree');
  await execute('git', ['worktree', 'add', '-b', 'preview', worktree], {
    cwd: root,
  });
  await mkdir(directory);
  await writeFile(path, JSON.stringify(document));
  assert.equal((await readRepositoryGitPolicyFile(worktree)).state, 'missing');
  await mkdir(join(worktree, '.pulsepit'));
  await writeFile(
    join(worktree, '.pulsepit/git-policy.json'),
    JSON.stringify({
      version: 1,
      remote: 'origin',
      branches: { 'future/release': rule },
    }),
  );
  const result = await readRepositoryGitPolicyFile(worktree);
  assert.equal(result.state, 'loaded');
  assert.deepEqual(Object.keys(result.declaration?.branches ?? {}), [
    'future/release',
  ]);
  assert.equal(
    (await readRepositoryGitPolicyFile(root)).declaration?.branches.main
      .directPush,
    'forbidden',
  );
});
