import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { promisify } from 'node:util';
import { createCommandEnvironment } from '../src/services/command-environment.service.js';
import { compareDeploymentCommit } from '../src/services/deployment-comparison.service.js';
import {
  fetchRepository,
  getGitStatus,
  getLocalBranches,
} from '../src/services/git.service.js';
import {
  getDevelopLastCommitAt,
  getLastActivityAt,
} from '../src/services/git-commit.service.js';
import { getOriginRemote } from '../src/services/git-origin.service.js';
import { pushRepositoryBranch } from '../src/services/git-push.service.js';
import { getGitSync } from '../src/services/git-sync.service.js';
import { getOutdatedDependencies } from '../src/services/outdated.service.js';
import { getPackageManifest } from '../src/services/package.service.js';

const execute = promisify(execFile);

function patchEnvironment(t: TestContext, values: NodeJS.ProcessEnv) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-command-env-'));
  const path = join(root, 'project');
  t.after(() => rm(root, { recursive: true, force: true }));
  await execute('git', ['init', '--initial-branch=main', path]);
  const git = async (...args: string[]) =>
    (await execute('git', args, { cwd: path })).stdout.trim();
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({ name: 'project', version: '1.0.0' }),
  );
  await git('add', 'package.json');
  await git(
    '-c',
    'user.name=Environment Test',
    '-c',
    'user.email=environment@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Initial',
  );
  const sha = await git('rev-parse', 'HEAD');
  const remote = join(root, 'remote.git');
  await git('clone', '--bare', path, remote);
  await git('remote', 'add', 'origin', remote);
  await git('update-ref', 'refs/remotes/origin/main', sha);
  await git('update-ref', 'refs/remotes/origin/develop', sha);
  await git('config', 'branch.main.remote', 'origin');
  await git('config', 'branch.main.merge', 'refs/heads/main');
  return { root, path, remote, sha, git };
}

test('explicit environments drop API secrets and injected execution context while preserving purpose-specific credentials', () => {
  const source = Object.freeze({
    PATH: '/tools',
    HOME: '/user',
    SSH_AUTH_SOCK: '/agent',
    GIT_SSH_COMMAND: 'ssh -i /key',
    GIT_CONFIG_GLOBAL: '/user/gitconfig',
    HTTPS_PROXY: 'https://proxy.invalid',
    NODE_EXTRA_CA_CERTS: '/cert',
    npm_config_registry: 'https://registry.invalid',
    NODE_AUTH_TOKEN: 'registry-token',
    NPM_TOKEN: 'npm-token',
    YARN_NPM_AUTH_TOKEN: 'yarn-token',
    GITHUB_TOKEN: 'api-github',
    VERCEL_TOKEN: 'api-vercel',
    GH_TOKEN: 'other-github',
    arbitrary_secret: 'other-secret',
    NODE_OPTIONS: '--import=/unexpected.mjs',
    GIT_DIR: '/wrong-repository',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: '/dev/null',
    GIT_CONFIG_PARAMETERS: 'unsafe',
    HUSKY: '0',
  });
  const git = createCommandEnvironment('git', source);
  const packages = createCommandEnvironment('package-manager', source);
  for (const child of [git, packages]) {
    for (const key of [
      'GITHUB_TOKEN',
      'VERCEL_TOKEN',
      'GH_TOKEN',
      'arbitrary_secret',
      'NODE_OPTIONS',
      'GIT_DIR',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_CONFIG_PARAMETERS',
      'HUSKY',
    ])
      assert.equal(child[key], undefined, key);
    assert.equal(child.PATH, source.PATH);
    assert.equal(child.HOME, source.HOME);
    assert.equal(child.HTTPS_PROXY, source.HTTPS_PROXY);
    assert.equal(child.NODE_EXTRA_CA_CERTS, source.NODE_EXTRA_CA_CERTS);
  }
  assert.equal(git.SSH_AUTH_SOCK, source.SSH_AUTH_SOCK);
  assert.equal(git.GIT_SSH_COMMAND, source.GIT_SSH_COMMAND);
  assert.equal(git.GIT_CONFIG_GLOBAL, source.GIT_CONFIG_GLOBAL);
  assert.equal(git.GIT_TERMINAL_PROMPT, '0');
  assert.equal(git.GCM_INTERACTIVE, 'Never');
  for (const key of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'YARN_NPM_AUTH_TOKEN']) {
    assert.equal(git[key], undefined);
    assert.equal(packages[key], source[key as keyof typeof source]);
  }
  assert.equal(packages.npm_config_registry, source.npm_config_registry);
  assert.equal(source.GITHUB_TOKEN, 'api-github');
  assert.equal(source.HUSKY, '0');
});

test('a real push executes its local hook without giving it Pulsepit API or registry tokens', async (t) => {
  const { root, path } = await fixture(t);
  const marker = join(root, 'hook.json');
  await writeFile(
    join(path, '.git/hooks/pre-push'),
    `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
for (const key of ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN', 'HUSKY', 'NODE_OPTIONS', 'PULSEPIT_TEST_SECRET']) assert.equal(process.env[key], undefined, key);
assert.equal(process.env.SSH_AUTH_SOCK, '/test/ssh-agent');
assert.equal(process.env.GIT_TERMINAL_PROMPT, '0');
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ ran: true }));
`,
    { mode: 0o755 },
  );
  patchEnvironment(t, {
    GITHUB_TOKEN: 'fake-github',
    VERCEL_TOKEN: 'fake-vercel',
    NODE_AUTH_TOKEN: 'fake-registry',
    NPM_TOKEN: 'fake-npm',
    HUSKY: '0',
    NODE_OPTIONS: '',
    SSH_AUTH_SOCK: '/test/ssh-agent',
    PULSEPIT_TEST_SECRET: 'fake-secret',
  });
  assert.deepEqual(await pushRepositoryBranch(path, 'main'), { success: true });
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), { ran: true });
  assert.equal(process.env.GITHUB_TOKEN, 'fake-github');
});

test('every Git reader, simple-git client and fetch receives the reduced environment', async (t) => {
  const { root, path, sha } = await fixture(t);
  const realGit = (await execute('which', ['git'])).stdout.trim();
  const bin = join(root, 'bin');
  const log = join(root, 'commands.jsonl');
  await mkdir(bin);
  await writeFile(
    join(bin, 'git'),
    `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
for (const key of ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'PULSEPIT_TEST_SECRET', 'NODE_AUTH_TOKEN']) assert.equal(process.env[key], undefined, key);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const result = cp.spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o755 },
  );
  patchEnvironment(t, {
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_TOKEN: 'fake-github',
    VERCEL_TOKEN: 'fake-vercel',
    PULSEPIT_TEST_SECRET: 'fake-secret',
    NODE_AUTH_TOKEN: 'fake-registry',
  });
  assert.equal((await getGitStatus(path)).branch, 'main');
  assert.equal(
    (await getPackageManifest(path, 'main')).manifest?.version,
    '1.0.0',
  );
  assert.equal((await getLocalBranches(path)).error, null);
  assert.equal((await getOriginRemote(path)).originError, null);
  assert.ok(await getDevelopLastCommitAt(path));
  assert.ok(await getLastActivityAt(path));
  assert.deepEqual(await getGitSync(path, 'main'), {
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
  });
  assert.equal(
    (await compareDeploymentCommit(path, { branch: 'main', commit: sha }))
      .status,
    'up_to_date',
  );
  assert.deepEqual(await fetchRepository(path), { success: true });
  const commands: string[][] = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  for (const name of [
    'status',
    'show',
    'remote',
    'log',
    'for-each-ref',
    'rev-list',
    'cat-file',
    'fetch',
  ])
    assert.ok(
      commands.some((args) => args.includes(name)),
      name,
    );
});

test('npm, pnpm and Yarn Modern diagnostics retain registry credentials without receiving API secrets', async (t) => {
  const { root, path } = await fixture(t);
  const bin = join(root, 'package-bin');
  const log = join(root, 'packages.jsonl');
  await mkdir(bin);
  const script = `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
for (const key of ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'PULSEPIT_TEST_SECRET']) assert.equal(process.env[key], undefined, key);
assert.equal(process.env.NODE_AUTH_TOKEN, 'registry-fixture');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(1)) + '\\n');
if (process.argv[2] === '--version') console.log('4.6.0');
else if (process.argv[2] === 'info') console.log(JSON.stringify({ value: 'project@workspace:.', children: { Dependencies: [] } }));
else console.log('{}');
`;
  for (const name of ['npm', 'pnpm', 'yarn'])
    await writeFile(join(bin, name), script, { mode: 0o755 });
  patchEnvironment(t, {
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_TOKEN: 'fake-github',
    VERCEL_TOKEN: 'fake-vercel',
    PULSEPIT_TEST_SECRET: 'fake-secret',
    NODE_AUTH_TOKEN: 'registry-fixture',
  });
  for (const [name, version] of [
    ['npm', '11.0.0'],
    ['pnpm', '12.14.0'],
    ['yarn', '4.6.0'],
  ]) {
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({ name: 'project', packageManager: `${name}@${version}` }),
    );
    const result = await getOutdatedDependencies(path);
    assert.equal(result.error, null);
    assert.equal('packageManager' in result && result.packageManager, name);
  }
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 4);
});
