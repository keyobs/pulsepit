import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ListRepositoriesResponse, Repository } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const execute = promisify(execFile);

test('repository list satisfies the shared contract with Git, package and deployment data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-list-contract-'));
  const path = join(root, 'project');
  const urls = { production: 'https://project.example.com' };
  const hosting = { production: 'https://vercel.com/team/project' };
  const app = buildApp(
    { port: 3001, scanPaths: [root] },
    { [path]: urls },
    { [path]: hosting },
  );
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await execute('git', ['init', '--initial-branch=main', path]);
  const git = (...args: string[]) => execute('git', args, { cwd: path });
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({
      name: 'project',
      version: '1.2.3',
      packageManager: 'pnpm@12.14.0',
      engines: { node: '>=22' },
    }),
  );
  await git('add', 'package.json');
  await git(
    '-c',
    'user.name=Contract Test',
    '-c',
    'user.email=contract@example.invalid',
    'commit',
    '--no-gpg-sign',
    '-m',
    'Add package manifest',
  );
  await git('branch', 'develop');
  await git('remote', 'add', 'origin', 'git@github.com:zeebha/project.git');

  const response = await app.inject({
    method: 'GET',
    url: '/api/repositories',
  });
  assert.equal(response.statusCode, 200);
  const json: unknown = response.json();
  const parsed = ListRepositoriesResponse.parse(json);
  assert.deepEqual(parsed, json);
  assert.deepEqual(parsed.scanErrors, []);
  assert.equal(parsed.repositories.length, 1);
  const repository = parsed.repositories[0];
  assert.deepEqual(repository, {
    name: 'project',
    path,
    git: { branch: 'main', isClean: true, changedFiles: 0, untrackedFiles: 0 },
    gitError: null,
    sync: { upstream: null, ahead: null, behind: null },
    developLastCommitAt: null,
    versions: {
      head: { version: '1.2.3', error: null },
      main: { version: '1.2.3', error: null },
      develop: { version: '1.2.3', error: null },
    },
    engines: { node: '>=22' },
    enginesError: null,
    packageManager: { name: 'pnpm', source: 'packageManager', error: null },
    origin: {
      name: 'origin',
      url: 'git@github.com:zeebha/project.git',
      github: {
        owner: 'zeebha',
        repo: 'project',
        url: 'https://github.com/zeebha/project',
      },
    },
    originError: null,
    urls,
    beacon: { package: false, configuration: 'missing', active: false },
    hosting,
    deploymentEnvironments: [
      {
        environment: 'production',
        label: 'Production',
        branch: null,
        url: urls.production,
        hosting: { label: 'Vercel', url: hosting.production },
      },
    ],
  });
});

test('repository list preserves nullable data and partial scan errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-list-partial-contract-'));
  const empty = join(root, 'empty');
  const broken = join(root, 'broken');
  const missing = join(root, 'missing');
  const app = buildApp({ port: 3001, scanPaths: [root, missing] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await execute('git', ['init', '--initial-branch=main', empty]);
  await mkdir(join(broken, '.git'), { recursive: true });

  const response = await app.inject({
    method: 'GET',
    url: '/api/repositories',
  });
  assert.equal(response.statusCode, 200);
  const json: unknown = response.json();
  const parsed = ListRepositoriesResponse.parse(json);
  assert.deepEqual(parsed, json);
  assert.equal(parsed.repositories.length, 2);
  assert.deepEqual(parsed.scanErrors, [
    {
      path: missing,
      code: 'ENOENT',
      message: 'Directory does not exist.',
    },
  ]);

  const emptyRepository = parsed.repositories.find(
    (repo) => repo.path === empty,
  );
  assert.ok(emptyRepository);
  assert.equal(emptyRepository.engines, null);
  assert.equal(emptyRepository.enginesError, null);
  assert.deepEqual(emptyRepository.packageManager, {
    name: null,
    source: null,
    error: null,
  });
  assert.equal(emptyRepository.origin, null);
  assert.equal(emptyRepository.originError, null);
  assert.deepEqual(emptyRepository.urls, {});
  assert.deepEqual(emptyRepository.hosting, {});
  for (const version of Object.values(emptyRepository.versions)) {
    assert.equal(version.version, null);
    assert.equal(typeof version.error, 'string');
  }

  const brokenRepository = parsed.repositories.find(
    (repo) => repo.path === broken,
  );
  assert.ok(brokenRepository);
  assert.equal(brokenRepository.git, null);
  assert.equal(typeof brokenRepository.gitError, 'string');
  assert.equal(brokenRepository.origin, null);
  assert.equal(typeof brokenRepository.originError, 'string');
});

test('repository contract rejects incompatible mock formats and missing nullable fields', () => {
  const repository: Repository = {
    name: 'project',
    path: '/repos/project',
    git: null,
    gitError: null,
    sync: null,
    developLastCommitAt: null,
    versions: {
      head: { version: null, error: null },
      main: { version: null, error: null },
      develop: { version: null, error: null },
    },
    engines: null,
    enginesError: null,
    packageManager: { name: null, source: null, error: null },
    origin: null,
    originError: null,
    urls: {},
    hosting: {},
    deploymentEnvironments: [],
    beacon: { package: false, configuration: 'missing', active: false },
  };
  for (const incompatible of [
    { ...repository, versions: { ...repository.versions, head: '1.2.3' } },
    { ...repository, packageManager: 'pnpm' },
    {
      ...repository,
      hosting: {
        production: { label: 'Vercel', url: 'https://vercel.com/team/project' },
      },
    },
    { ...repository, engines: undefined },
    {
      ...repository,
      git: {
        branch: null,
        isClean: false,
        changedFiles: -1,
        untrackedFiles: 0,
      },
    },
  ]) {
    assert.equal(Repository.safeParse(incompatible).success, false);
  }
});
