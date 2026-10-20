import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  ErrorResponse,
  OutdatedDependency,
  OutdatedRequest,
  OutdatedResponse,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-outdated-contract-'));
  const projects = join(root, 'projects');
  const path = join(projects, 'project');
  const bin = join(root, 'bin');
  const previousPath = process.env.PATH;
  const app = buildApp({ port: 3001, scanPaths: [projects] });
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(path, '.git'), { recursive: true });
  await mkdir(bin);
  const fakeManager = `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const { basename } = require('node:path');
const manager = basename(process.argv[1]);
const args = process.argv.slice(2);
const fixture = JSON.parse(readFileSync('.outdated-contract.json', 'utf8'));
if (manager === 'yarn') {
  if (args[0] === '--version') process.stdout.write('4.9.2');
  else if (args[0] === 'info') process.stdout.write(JSON.stringify({
    value: 'project@workspace:.',
    children: { Dependencies: fixture.empty ? [] : [{ descriptor: 'shared@npm:^1.0.0', locator: 'shared@npm:1.0.0' }] },
  }));
  else if (args[0] === 'npm' && args[1] === 'info') process.stdout.write(JSON.stringify({
    name: 'shared', version: args[2] === 'shared@latest' ? '2.0.0' : '1.2.0',
  }));
  else throw new Error('Unexpected Yarn command.');
} else {
  if (!args.includes('outdated')) throw new Error('Unexpected package manager command.');
  process.stdout.write(fixture.invalid ? 'invalid JSON' : JSON.stringify(fixture.empty ? {} : {
    shared: { wanted: '1.2.0', latest: '2.0.0' },
  }));
  process.exitCode = fixture.empty ? 0 : 1;
}
`;
  for (const manager of ['npm', 'pnpm', 'yarn']) {
    await writeFile(join(bin, manager), fakeManager, { mode: 0o755 });
  }
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  async function report(options: { empty?: boolean; invalid?: boolean } = {}) {
    await writeFile(
      join(path, '.outdated-contract.json'),
      JSON.stringify(options),
    );
  }
  async function manifest(packageManager: string) {
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({ packageManager }),
    );
  }
  const diagnose = () =>
    app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: OutdatedRequest.parse({ path: `${path}/.` }),
    });
  return { path, report, manifest, diagnose };
}

test('outdated contracts parse normalized npm, pnpm and modern Yarn reports, including empty results', async (t) => {
  const { path, report, manifest, diagnose } = await fixture(t);
  await report();
  for (const [manager, version] of [
    ['npm', '11.0.0'],
    ['pnpm', '12.14.0'],
    ['yarn', '4.9.2'],
  ] as const) {
    await manifest(`${manager}@${version}`);
    const response = await diagnose();
    assert.equal(response.statusCode, 200);
    const parsed = OutdatedResponse.parse(response.json());
    assert.deepEqual(parsed, response.json());
    assert.deepEqual(parsed, {
      path,
      packageManager: manager,
      dependencies: [
        {
          name: 'shared',
          current: manager === 'yarn' ? '1.0.0' : null,
          wanted: '1.2.0',
          latest: '2.0.0',
          dependent: manager === 'yarn' ? 'project' : null,
          location: manager === 'yarn' ? path : null,
        },
      ],
      error: null,
    });
  }
  await report({ empty: true });
  const empty = await diagnose();
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(OutdatedResponse.parse(empty.json()), {
    path,
    packageManager: 'yarn',
    dependencies: [],
    error: null,
  });
});

test('outdated contracts reject incomplete formats and distinguish a failed diagnostic from an empty report', async (t) => {
  assert.equal(OutdatedRequest.safeParse({ path: '' }).success, false);
  assert.equal(
    OutdatedDependency.safeParse({
      name: 'shared',
      current: null,
      wanted: '1.2.0',
      latest: '2.0.0',
    }).success,
    false,
  );
  const { report, manifest, diagnose } = await fixture(t);
  await manifest('npm@11.0.0');
  await report({ invalid: true });
  const failure = await diagnose();
  assert.equal(failure.statusCode, 502);
  assert.equal(ErrorResponse.parse(failure.json()).code, 'INVALID_OUTPUT');
  assert.equal(OutdatedResponse.safeParse(failure.json()).success, false);

  await manifest('unsupported@1.0.0');
  const unsupported = await diagnose();
  assert.equal(unsupported.statusCode, 422);
  assert.equal(ErrorResponse.parse(unsupported.json()).code, 'PACKAGE_MANAGER');
  assert.equal(OutdatedResponse.safeParse(unsupported.json()).success, false);
});
