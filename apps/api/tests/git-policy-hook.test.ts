import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { GitPolicyFile } from '@pulsepit/contracts';
import { validateDeclaration } from '../../../scripts/hooks/pulsepit-pre-push.mjs';

const execute = promisify(execFile);
const adapter = fileURLToPath(
  new URL('../../../scripts/hooks/pulsepit-pre-push.mjs', import.meta.url),
);
const rule = (directPush: string, requiredChecks: string[] = []) => ({
  directPush,
  requiredChecks,
});
const document = {
  version: 1,
  remote: 'origin',
  default: { directPush: 'unknown', requiredChecks: null },
  branches: {
    main: rule('forbidden'),
    master: rule('forbidden'),
    develop: rule('allowed', ['lint-fix', 'test-run']),
  },
};
async function git(path: string, ...args: string[]) {
  return (await execute('git', args, { cwd: path })).stdout.trim();
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'project');
  const remote = join(root, 'remote.git');
  const log = join(root, 'checks.log');
  const flags = join(root, 'flags.json');
  await execute('git', ['init', '--initial-branch=develop', path]);
  await mkdir(join(path, '.pulsepit'));
  await mkdir(join(path, '.husky'));
  const policyPath = join(path, '.pulsepit/git-policy.json');
  await writeFile(policyPath, JSON.stringify(document));
  await copyFile(adapter, join(path, '.husky/guard.mjs'));
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    '#!/bin/sh\nexec node .husky/guard.mjs "$@"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: {
        'lint:fix': 'node checks.mjs lint',
        'test:run': 'node checks.mjs tests',
      },
    }),
  );
  await writeFile(join(path, 'app.txt'), 'Original\n');
  await writeFile(flags, '{}');
  await writeFile(
    join(path, 'checks.mjs'),
    `import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';\nconst step=process.argv[2];\nconst flags=JSON.parse(readFileSync(${JSON.stringify(flags)},'utf8'));\nappendFileSync(${JSON.stringify(log)},step+'\\n');\nif (flags.change && step==='lint') writeFileSync('app.txt','Modified\\n');\nif ((flags.failTests && step==='tests') || (flags.failLint && step==='lint')) process.exit(1);\n`,
  );
  await git(path, 'add', '.');
  await git(
    path,
    '-c',
    'user.name=Hook Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  await git(path, 'branch', 'main');
  await git(path, 'branch', 'feature/example');
  await git(root, 'init', '--bare', remote);
  await git(path, 'remote', 'add', 'origin', remote);
  const push = (...refs: string[]) =>
    git(path, 'push', '--porcelain', 'origin', ...refs);
  const setFlags = (value: object) => writeFile(flags, JSON.stringify(value));
  const checks = async () => {
    try {
      return await readFile(log, 'utf8');
    } catch {
      return '';
    }
  };
  return { path, remote, policyPath, log, push, setFlags, checks };
}

test('portable hook and backend agree on the versioned declaration format', () => {
  for (const value of [
    document,
    { version: 1, remote: 'origin' },
    { ...document, version: 2 },
    { ...document, command: 'npm test' },
    { ...document, branches: { main: { directPush: 'allowed' } } },
    {
      ...document,
      branches: { main: rule('allowed', ['duplicate', 'duplicate']) },
    },
    { ...document, default: { ...rule('allowed'), unexpected: true } },
  ]) {
    let accepted = true;
    try {
      validateDeclaration(value);
    } catch {
      accepted = false;
    }
    assert.equal(accepted, GitPolicyFile.safeParse(value).success);
  }
});

test('real pre-push rejects protected targets independently of HEAD and checks all refs before running scripts', async (t) => {
  const { path, remote, push, checks } = await fixture(t);
  await assert.rejects(push('refs/heads/main:refs/heads/main'), /forbidden/);
  assert.equal(await git(path, 'branch', '--show-current'), 'develop');
  await assert.rejects(
    push(
      'refs/heads/feature/example:refs/heads/feature/example',
      'refs/heads/main:refs/heads/main',
    ),
    /forbidden/,
  );
  assert.equal(await checks(), '');
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)'), '');
});

test('mandatory checks reject a different source context and failures, then allow exactly the tested commit; advisory tests remain advisory', async (t) => {
  const { path, remote, log, push, setFlags, checks } = await fixture(t);
  await git(path, 'checkout', 'feature/example');
  await assert.rejects(
    push('refs/heads/develop:refs/heads/develop'),
    /current branch/,
  );
  assert.equal(await checks(), '');
  await setFlags({ failTests: true });
  await assert.rejects(
    push('refs/heads/feature/example:refs/heads/develop'),
    /Required tests failed/,
  );
  assert.equal(await checks(), 'lint\ntests\n');
  await rm(log);
  await git(path, 'checkout', 'develop');
  await setFlags({ failTests: true });
  await assert.rejects(
    push('refs/heads/develop:refs/heads/develop'),
    /Required tests failed/,
  );
  assert.equal(await checks(), 'lint\ntests\n');
  await setFlags({});
  await rm(log);
  await push('refs/heads/develop:refs/heads/develop');
  assert.equal(await checks(), 'lint\ntests\n');
  assert.equal(
    await git(remote, 'rev-parse', 'develop'),
    await git(path, 'rev-parse', 'develop'),
  );
  await setFlags({ failTests: true });
  await push('refs/heads/feature/example:refs/heads/feature/example');
  assert.equal(
    await git(remote, 'rev-parse', 'feature/example'),
    await git(path, 'rev-parse', 'feature/example'),
  );
});

test('missing/invalid declarations and unsupported checks reject pushes; lint modifications invalidate the required context', async (t) => {
  const { path, remote, policyPath, push, setFlags, checks } = await fixture(t);
  await writeFile(policyPath, '{"private":"do-not-expose"');
  await assert.rejects(push('refs/heads/main:refs/heads/main'), (error) => {
    assert.equal(String(error).includes('do-not-expose'), false);
    return true;
  });
  await rm(policyPath);
  await assert.rejects(push('refs/heads/main:refs/heads/main'));
  await writeFile(
    policyPath,
    JSON.stringify({
      ...document,
      branches: { main: rule('allowed', ['unsupported']) },
    }),
  );
  await assert.rejects(
    push('refs/heads/main:refs/heads/main'),
    /supported package script/,
  );
  assert.equal(await checks(), '');
  await writeFile(policyPath, JSON.stringify(document));
  await setFlags({ change: true });
  await assert.rejects(
    push('refs/heads/develop:refs/heads/develop'),
    /working tree changed/,
  );
  assert.equal(await checks(), 'lint\n');
  assert.equal(await readFile(join(path, 'app.txt'), 'utf8'), 'Modified\n');
  assert.equal(await git(remote, 'for-each-ref', '--format=%(refname)'), '');
});
