import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  ErrorResponse,
  WorkflowEntry,
  WorkflowsResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const workflowsUrl = (path: string) =>
  `/api/repositories/workflows?${new URLSearchParams({ path })}`;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-workflows-contract-'));
  const path = join(root, 'project');
  const app = buildApp({ port: 3001, scanPaths: [root] });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(path, '.git'), { recursive: true });
  return { root, path, app };
}

test('shared workflows contract parses GitHub analysis and errors, GitLab discovery and partial scan errors', async (t) => {
  const { path, app } = await fixture(t);
  const directory = join(path, '.github', 'workflows');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'deploy.yml'),
    [
      'name: Deploy',
      'on:',
      '  push:',
      '    branches: [main]',
      'jobs:',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '    environment:',
      '      name: production',
      '      url: https://project.example.invalid',
      '    steps:',
      '      - run: echo preview',
    ].join('\n'),
  );
  await writeFile(join(directory, 'broken.yml'), 'name: [\n');
  await writeFile(join(path, '.gitlab-ci.yml'), 'stages: [test]\n');
  await symlink(join(directory, 'deploy.yml'), join(directory, 'linked.yml'));

  const response = await app.inject({
    method: 'GET',
    url: workflowsUrl(`${path}/.`),
  });
  assert.equal(response.statusCode, 200);
  const parsed = WorkflowsResponse.parse(response.json());
  assert.deepEqual(parsed, response.json());
  assert.equal(parsed.path, path);
  assert.equal(parsed.workflows.length, 3);
  const valid = parsed.workflows.find(
    (workflow) => workflow.file === '.github/workflows/deploy.yml',
  );
  assert.ok(valid?.provider === 'github-actions');
  assert.ok(valid.analysis);
  assert.equal(valid.analysisError, null);
  assert.equal(valid.analysis.name, 'Deploy');
  assert.deepEqual(valid.analysis.on, ['push']);
  assert.deepEqual(valid.analysis.branches, ['main']);
  assert.deepEqual(valid.analysis.branchFilters, {
    push: { include: ['main'], exclude: [] },
  });
  assert.deepEqual(valid.analysis.environments, [
    {
      job: 'deploy',
      name: 'production',
      isDynamic: false,
      url: 'https://project.example.invalid/',
      urlExpression: null,
    },
  ]);
  assert.equal(valid.analysis.deployment.status, 'environment_declared');
  assert.ok(
    valid.analysis.deployment.evidence.some(
      (item) => item.source === 'environment' && item.confidence === 'declared',
    ),
  );
  assert.equal(
    WorkflowEntry.safeParse({
      ...valid,
      analysisError: { code: 'READ_FAILED', message: 'Contradictory error.' },
    }).success,
    false,
  );

  const broken = parsed.workflows.find(
    (workflow) => workflow.file === '.github/workflows/broken.yml',
  );
  assert.ok(broken?.provider === 'github-actions');
  assert.equal(broken.analysis, null);
  assert.equal(broken.analysisError?.code, 'INVALID_YAML');
  assert.deepEqual(
    parsed.workflows.find((workflow) => workflow.provider === 'gitlab-ci'),
    {
      provider: 'gitlab-ci',
      file: '.gitlab-ci.yml',
    },
  );
  assert.deepEqual(parsed.errors, [
    {
      path: '.github/workflows/linked.yml',
      code: 'UNSUPPORTED_PATH',
      message: 'Workflow files must not be symbolic links.',
    },
  ]);
});

test('shared workflow contracts separate empty results and HTTP errors and reject incomplete analysis states', async (t) => {
  for (const invalid of [
    { provider: 'github-actions', file: 'ci.yml' },
    {
      provider: 'github-actions',
      file: 'ci.yml',
      analysis: null,
      analysisError: null,
    },
    {
      provider: 'github-actions',
      file: 'ci.yml',
      analysis: null,
      analysisError: { code: 'UNKNOWN', message: 'Unsupported error code.' },
    },
    { provider: 'unknown', file: 'ci.yml' },
  ]) {
    assert.equal(WorkflowEntry.safeParse(invalid).success, false);
  }
  const { root, path, app } = await fixture(t);
  const response = await app.inject({ method: 'GET', url: workflowsUrl(path) });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(WorkflowsResponse.parse(response.json()), {
    path,
    workflows: [],
    errors: [],
  });

  for (const [url, status] of [
    ['/api/repositories/workflows', 400],
    [workflowsUrl(root), 404],
  ] as const) {
    const failure = await app.inject({ method: 'GET', url });
    assert.equal(failure.statusCode, status);
    assert.equal(typeof ErrorResponse.parse(failure.json()).error, 'string');
    assert.equal(WorkflowsResponse.safeParse(failure.json()).success, false);
  }
});
