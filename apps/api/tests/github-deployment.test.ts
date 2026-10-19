import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stringify } from 'yaml';
import { buildApp } from '../src/app.js';
import { parseGithubWorkflow } from '../src/services/github-workflow.service.js';

const file = '.github/workflows/deploy.yml';
function analyze(jobs: Record<string, unknown>) {
  const result = parseGithubWorkflow(stringify({ on: 'push', jobs }), file);
  assert.equal(result.analysisError, null);
  assert.ok(result.analysis);
  return result.analysis;
}

test('GitHub environments and deployment evidence', async (t) => {
  await t.test(
    'extracts both supported environment forms and links them to jobs',
    () => {
      const analysis = analyze({
        first: { environment: 'production' },
        second: {
          environment: { name: 'staging', url: 'https://APP.example.invalid' },
        },
      });
      assert.deepEqual(analysis.environments, [
        {
          job: 'first',
          name: 'production',
          isDynamic: false,
          url: null,
          urlExpression: null,
        },
        {
          job: 'second',
          name: 'staging',
          isDynamic: false,
          url: 'https://app.example.invalid/',
          urlExpression: null,
        },
      ]);
      assert.equal(analysis.deployment.status, 'environment_declared');
      assert.ok(
        analysis.deployment.evidence.every(
          (item) => item.confidence === 'declared',
        ),
      );
    },
  );

  await t.test(
    'preserves expressions without treating them as resolved environment names or URLs',
    () => {
      const name = `\${{ matrix.environment }}`;
      const url = `https://\${{ steps.deploy.outputs.host }}`;
      const analysis = analyze({ release: { environment: { name, url } } });
      assert.deepEqual(analysis.environments, [
        {
          job: 'release',
          name,
          isDynamic: true,
          url: null,
          urlExpression: url,
        },
      ]);
    },
  );

  await t.test(
    'labels names, actions and commands as heuristic evidence without exposing commands',
    () => {
      const analysis = analyze({
        deploy_production: {
          steps: [
            { name: 'Deploy application' },
            { uses: 'actions/deploy-pages@v4' },
            { run: 'pnpm run deploy --token=private-test-token' },
          ],
        },
      });
      assert.equal(analysis.deployment.status, 'suspected');
      assert.deepEqual(analysis.environments, []);
      assert.deepEqual(
        analysis.deployment.evidence.map((item) => item.source),
        ['job_name', 'step_name', 'action', 'command'],
      );
      assert.ok(
        analysis.deployment.evidence.every(
          (item) => item.confidence === 'heuristic',
        ),
      );
      assert.ok(!JSON.stringify(analysis).includes('private-test-token'));
    },
  );

  await t.test(
    'does not infer environments from NODE_ENV, publication or action version tags',
    () => {
      const analysis = analyze({
        build: {
          env: { NODE_ENV: 'production' },
          steps: [
            { uses: 'actions/checkout@deploy-example' },
            { name: 'Publish test artifacts', run: 'npm publish --dry-run' },
          ],
        },
      });
      assert.deepEqual(analysis.environments, []);
      assert.deepEqual(analysis.deployment, {
        status: 'not_detected',
        evidence: [],
      });
    },
  );

  await t.test(
    'marks reusable workflows as unknown and their names as hints only',
    () => {
      const unknown = analyze({
        reusable: { uses: 'owner/repo/.github/workflows/ci.yml@deploy-ref' },
      });
      assert.equal(unknown.deployment.status, 'unknown');
      assert.equal(unknown.deployment.evidence.length, 1);
      assert.equal(unknown.deployment.evidence[0].confidence, 'unknown');
      const suspected = analyze({
        reusable: { uses: './.github/workflows/deploy.yml' },
      });
      assert.equal(suspected.deployment.status, 'suspected');
      assert.deepEqual(
        suspected.deployment.evidence.map((item) => item.confidence),
        ['unknown', 'heuristic'],
      );
    },
  );

  await t.test(
    'reports invalid environment metadata without including sensitive URLs in errors',
    () => {
      for (const environment of [
        null,
        42,
        {},
        { name: '' },
        { name: false },
        { name: 'production', url: 42 },
        { name: 'production', url: 'javascript:alert(1)' },
        {
          name: 'production',
          url: 'https://user:private-test-token@example.invalid',
        },
      ]) {
        const result = parseGithubWorkflow(
          stringify({ on: 'push', jobs: { release: { environment } } }),
          file,
        );
        assert.equal(result.analysis, null);
        assert.equal(result.analysisError?.code, 'INVALID_WORKFLOW');
        assert.ok(!JSON.stringify(result).includes('private-test-token'));
      }
    },
  );

  await t.test(
    'a declared environment describes configuration even for a conditional job',
    () => {
      const analysis = analyze({
        release: { if: false, environment: 'production' },
        tests: { steps: [{ run: 'npm test' }] },
      });
      assert.equal(analysis.deployment.status, 'environment_declared');
      assert.deepEqual(analysis.jobs, ['release', 'tests']);
      assert.equal(analysis.environments.length, 1);
      assert.ok(!Object.hasOwn(analysis, 'deployedAt'));
      assert.ok(!Object.hasOwn(analysis, 'deploymentSucceeded'));
    },
  );

  await t.test(
    'exposes environments and evidence through the workflow API with per-file errors',
    async (r) => {
      const root = await mkdtemp(join(tmpdir(), 'pulsepit-deploy-metadata-'));
      const repository = join(root, 'repository');
      await mkdir(join(repository, '.git'), { recursive: true });
      await mkdir(join(repository, '.github/workflows'), { recursive: true });
      await writeFile(
        join(repository, file),
        stringify({
          on: 'push',
          jobs: {
            deploy: {
              environment: 'production',
              steps: [{ uses: 'actions/deploy-pages@v4' }],
            },
          },
        }),
      );
      await writeFile(
        join(repository, '.github/workflows/invalid.yml'),
        stringify({
          on: 'push',
          jobs: { build: { environment: { name: 42 } } },
        }),
      );
      const app = buildApp({ port: 3001, scanPaths: [root] });
      r.after(async () => {
        await app.close();
        await rm(root, { recursive: true, force: true });
      });
      const response = await app.inject({
        method: 'GET',
        url: `/api/repositories/workflows?${new URLSearchParams({ path: repository })}`,
      });
      assert.equal(response.statusCode, 200);
      const workflows = response.json().workflows;
      assert.equal(workflows.length, 2);
      const valid = workflows.find(
        (workflow: { file: string }) => workflow.file === file,
      );
      assert.equal(valid.analysis.environments[0].name, 'production');
      assert.equal(valid.analysis.deployment.status, 'environment_declared');
      assert.equal(valid.analysisError, null);
      const invalid = workflows.find((workflow: { file: string }) =>
        workflow.file.endsWith('invalid.yml'),
      );
      assert.equal(invalid.analysis, null);
      assert.equal(invalid.analysisError.code, 'INVALID_WORKFLOW');
    },
  );
});
