import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  compareDeploymentCommit,
  type DeploymentCommitComparison,
} from '../src/services/deployments/deployment-comparison.service.js';

const execute = promisify(execFile);

async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}

async function commit(path: string, message: string) {
  await git(
    path,
    '-c',
    'user.name=Comparison Test',
    '-c',
    'user.email=comparison@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    message,
  );
  return git(path, 'rev-parse', 'HEAD');
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-deployment-comparison-'));
  const path = join(root, 'project');
  await execute('git', ['init', '--initial-branch=main', path]);
  const base = await commit(path, 'Initial commit');
  const next = await commit(path, 'Second commit');
  const tip = await commit(path, 'Third commit');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, path, base, next, tip };
}

function assertUnknown(
  result: DeploymentCommitComparison,
  reason: DeploymentCommitComparison['reason'],
  referenceCommit: string | null = null,
) {
  assert.equal(result.status, 'unknown');
  assert.equal(result.ahead, null);
  assert.equal(result.behind, null);
  assert.equal(result.reason, reason);
  assert.equal(result.referenceCommit, referenceCommit);
}

test('counts deployment commits relative to the configured local branch, independently of HEAD and remote refs', async (t) => {
  const { path, base, tip } = await fixture(t);
  await git(path, 'branch', 'develop', base);
  await git(path, 'checkout', '-b', 'feature/release');
  const future = await commit(path, 'Unreleased deployment commit');
  await git(path, 'update-ref', 'refs/remotes/origin/main', future);
  const refs = await git(
    path,
    'for-each-ref',
    '--format=%(refname) %(objectname)',
  );
  for (const [observed, status, ahead, behind] of [
    [tip.toUpperCase(), 'up_to_date', 0, 0],
    [base, 'behind', 0, 2],
    [future, 'ahead', 1, 0],
  ] as const) {
    assert.deepEqual(
      await compareDeploymentCommit(path, { branch: 'main', commit: observed }),
      {
        reference: 'refs/heads/main',
        referenceCommit: tip,
        status,
        ahead,
        behind,
        reason: null,
      },
    );
  }
  assert.deepEqual(
    await compareDeploymentCommit(path, { branch: 'develop', commit: tip }),
    {
      reference: 'refs/heads/develop',
      referenceCommit: base,
      status: 'ahead',
      ahead: 2,
      behind: 0,
      reason: null,
    },
  );
  assert.equal(
    await git(path, 'for-each-ref', '--format=%(refname) %(objectname)'),
    refs,
  );
  await git(path, 'checkout', '-b', 'feature/divergent', base);
  const divergent = await commit(path, 'Different deployment history');
  assert.deepEqual(
    await compareDeploymentCommit(path, { branch: 'main', commit: divergent }),
    {
      reference: 'refs/heads/main',
      referenceCommit: tip,
      status: 'diverged',
      ahead: 1,
      behind: 2,
      reason: null,
    },
  );
});

test('distinguishes missing inputs, invalid or absent branches, absent commits and objects that are not commits', async (t) => {
  const { root, path, tip } = await fixture(t);
  const noBranch = await compareDeploymentCommit(path, {
    branch: null,
    commit: tip,
  });
  assertUnknown(noBranch, 'BRANCH_NOT_CONFIGURED');
  assert.equal(noBranch.reference, null);
  for (const observed of [null, '1234567', '--help', `${tip}\nHEAD`]) {
    assertUnknown(
      await compareDeploymentCommit(join(root, 'missing'), {
        branch: 'main',
        commit: observed,
      }),
      'COMMIT_UNAVAILABLE',
    );
  }
  for (const branch of [
    'main^{commit}',
    '../main',
    'main..other',
    'main\nHEAD',
  ]) {
    assertUnknown(
      await compareDeploymentCommit(path, { branch, commit: tip }),
      'INVALID_BRANCH',
    );
  }
  await git(path, 'update-ref', 'refs/remotes/origin/remote-only', tip);
  const missing = await compareDeploymentCommit(path, {
    branch: 'remote-only',
    commit: tip,
  });
  assertUnknown(missing, 'BRANCH_NOT_FOUND');
  assert.equal(missing.reference, 'refs/heads/remote-only');
  await writeFile(join(path, 'blob.txt'), 'Not a commit.');
  const blob = await git(path, 'hash-object', '-w', 'blob.txt');
  await git(
    path,
    '-c',
    'user.name=Comparison Test',
    '-c',
    'user.email=comparison@example.invalid',
    'tag',
    '--no-sign',
    '-a',
    'release-tag',
    '-m',
    'Annotated tag',
    tip,
  );
  const tag = await git(path, 'rev-parse', 'refs/tags/release-tag');
  for (const observed of ['f'.repeat(40), blob, tag]) {
    assertUnknown(
      await compareDeploymentCommit(path, { branch: 'main', commit: observed }),
      'COMMIT_NOT_FOUND',
      tip,
    );
  }
  const unborn = join(root, 'unborn');
  await execute('git', ['init', '--initial-branch=main', unborn]);
  assertUnknown(
    await compareDeploymentCommit(unborn, { branch: 'main', commit: tip }),
    'BRANCH_NOT_FOUND',
  );
  const broken = join(root, 'broken');
  await mkdir(join(broken, '.git'), { recursive: true });
  for (const directory of [broken, join(root, 'missing')]) {
    assertUnknown(
      await compareDeploymentCommit(directory, { branch: 'main', commit: tip }),
      'GIT_ERROR',
    );
  }
});

test('keeps unrelated histories unknown even when local replace refs would invent ancestry', async (t) => {
  const { path, tip } = await fixture(t);
  await git(path, 'checkout', '--orphan', 'unrelated');
  const unrelated = await commit(path, 'Independent history');
  assertUnknown(
    await compareDeploymentCommit(path, { branch: 'main', commit: unrelated }),
    'UNRELATED_HISTORY',
    tip,
  );
  await git(path, 'replace', '--graft', unrelated, tip);
  assert.equal(await git(path, 'merge-base', unrelated, tip), tip);
  assertUnknown(
    await compareDeploymentCommit(path, { branch: 'main', commit: unrelated }),
    'UNRELATED_HISTORY',
    tip,
  );
});

test('reads linked worktrees and refuses non-identical shallow histories while still proving identical commits', async (t) => {
  const { root, path, base, next, tip } = await fixture(t);
  const linked = join(root, 'linked');
  await git(path, 'worktree', 'add', '--detach', linked, base);
  assert.equal(
    (await compareDeploymentCommit(linked, { branch: 'main', commit: base }))
      .behind,
    2,
  );
  const shallow = join(root, 'shallow');
  await execute('git', [
    'clone',
    '--depth=2',
    '--branch=main',
    pathToFileURL(path).href,
    shallow,
  ]);
  assertUnknown(
    await compareDeploymentCommit(shallow, { branch: 'main', commit: next }),
    'SHALLOW_HISTORY',
    tip,
  );
  const shallowLinked = join(root, 'shallow-linked');
  await git(shallow, 'worktree', 'add', '--detach', shallowLinked, tip);
  assertUnknown(
    await compareDeploymentCommit(shallowLinked, {
      branch: 'main',
      commit: next,
    }),
    'SHALLOW_HISTORY',
    tip,
  );
  assert.deepEqual(
    await compareDeploymentCommit(shallowLinked, {
      branch: 'main',
      commit: tip,
    }),
    {
      reference: 'refs/heads/main',
      referenceCommit: tip,
      status: 'up_to_date',
      ahead: 0,
      behind: 0,
      reason: null,
    },
  );
});

test('honors the total time budget and never lazily fetches missing objects in a partial clone', async (t) => {
  const { path, tip } = await fixture(t);
  assertUnknown(
    await compareDeploymentCommit(path, { branch: 'main', commit: tip }, 0),
    'TIMEOUT',
  );
  const transport = join(path, 'reject-transport.sh');
  const marker = join(path, 'transport-used');
  await writeFile(transport, '#!/bin/sh\n: > "$PWD/transport-used"\nexit 1\n');
  await chmod(transport, 0o700);
  await git(path, 'config', 'core.repositoryformatversion', '1');
  await git(path, 'config', 'extensions.partialClone', 'origin');
  await git(path, 'config', 'remote.origin.promisor', 'true');
  await git(path, 'config', 'remote.origin.partialclonefilter', 'blob:none');
  await git(
    path,
    'config',
    'remote.origin.url',
    'ssh://example.invalid/project.git',
  );
  await git(path, 'config', 'core.sshCommand', './reject-transport.sh');
  assertUnknown(
    await compareDeploymentCommit(path, {
      branch: 'main',
      commit: 'f'.repeat(40),
    }),
    'COMMIT_NOT_FOUND',
    tip,
  );
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await assert.rejects(readFile(join(path, '.git', 'FETCH_HEAD')), {
    code: 'ENOENT',
  });
});
