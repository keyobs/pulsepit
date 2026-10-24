import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { ErrorResponse, OutdatedResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-pnpm-warnings-'));
  const path = join(root, 'project');
  const bin = join(root, 'bin');
  const originalPath = process.env.PATH;
  await mkdir(join(path, '.git'), { recursive: true });
  await mkdir(bin);
  const app = buildApp({ port: 3001, scanPaths: [root] });
  app.log.level = 'silent';
  t.after(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const script = join(bin, 'manager.cjs');
  await writeFile(
    script,
    "const fs=require('node:fs');const fixture=JSON.parse(fs.readFileSync('fixture.json','utf8'));fs.writeSync(1,fixture.output);fs.writeSync(2,'private-stderr-do-not-expose');process.exitCode=fixture.exitCode;\n",
  );
  for (const name of ['pnpm', 'npm'])
    await writeFile(
      join(bin, name),
      `#!/bin/sh\nunset NODE_TEST_CONTEXT\nexec "${process.execPath}" "${script}" "$@"\n`,
      { mode: 0o755 },
    );
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
  async function diagnose(output: string, exitCode = 1, manager = 'pnpm') {
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({ packageManager: `${manager}@10.22.0` }),
    );
    await writeFile(
      join(path, 'fixture.json'),
      JSON.stringify({ output, exitCode }),
    );
    return app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path },
    });
  }
  return { path, diagnose };
}
const report = JSON.stringify(
  { '@scope/library': { current: '1.0.0', wanted: '1.2.0', latest: '2.0.0' } },
  null,
  2,
);
const launcherWarning =
  'pnpm is running through Node.js because the script that installs its native binary was skipped.\n' +
  'Reinstall pnpm with its build scripts allowed to run the binary directly.\n';

test('pnpm reports remain valid when legacy warnings surround the JSON, including Unicode and ANSI warning labels', async (t) => {
  const { path, diagnose } = await fixture(t);
  for (const output of [
    report,
    `${launcherWarning}${report}`,
    `${launcherWarning} WARN  Slow request\n${report}`,
    ` WARN  Request took 414ms: private-registry-do-not-expose\n${report}`,
    `[WARN] Slow request: private-registry-do-not-expose\r\n${report}\r\n[WARN] Retrying metadata request\r\n`,
    `\u001b[33m WARN \u001b[39m Slow request\n\n${report}\n`,
  ]) {
    const response = await diagnose(output);
    assert.equal(
      response.statusCode,
      200,
      JSON.stringify({ output, body: response.json() }),
    );
    assert.deepEqual(OutdatedResponse.parse(response.json()), {
      path,
      packageManager: 'pnpm',
      dependencies: [
        {
          name: '@scope/library',
          current: '1.0.0',
          wanted: '1.2.0',
          latest: '2.0.0',
          dependent: null,
          location: null,
        },
      ],
      error: null,
    });
    assert.equal(response.body.includes('private-'), false);
  }
  const empty = await diagnose(' WARN  Slow request\n{}\n', 0);
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(OutdatedResponse.parse(empty.json()).dependencies, []);
  const launcherEmpty = await diagnose(`${launcherWarning}{}`, 0);
  assert.equal(launcherEmpty.statusCode, 200);
  assert.deepEqual(
    OutdatedResponse.parse(launcherEmpty.json()).dependencies,
    [],
  );
});

test('warnings never hide fatal errors, arbitrary text, truncated or multiple reports, or turn failed commands into empty success', async (t) => {
  const { diagnose } = await fixture(t);
  for (const output of [
    `ERR_PNPM_FETCH_500 private-registry-do-not-expose\n${report}`,
    `notice private-registry-do-not-expose\n${report}`,
    `${launcherWarning.split('\n')[0]}\n${report}`,
    `${launcherWarning}ERR_PNPM_FETCH_500 private-registry-do-not-expose\n${report}`,
    ` WARN  Slow request\n${report.slice(0, -1)}`,
    ` WARN  Slow request\n${report}\n{}`,
    ` WARN  Slow request\n{"error":{"code":"ERR_PNPM_FETCH_500"}}`,
    ` WARN  private-registry-do-not-expose\n`,
  ]) {
    const response = await diagnose(output);
    assert.equal(response.statusCode, 502);
    assert.equal(
      ErrorResponse.parse(response.json()).code,
      output.includes('ERR_PNPM_FETCH_500')
        ? 'REGISTRY_UNAVAILABLE'
        : 'INVALID_OUTPUT',
    );
    assert.equal(response.body.includes('private-'), false);
    assert.equal(OutdatedResponse.safeParse(response.json()).success, false);
  }
  const emptyFailure = await diagnose(' WARN  Slow request\n{}', 1);
  assert.equal(emptyFailure.statusCode, 502);
  assert.equal(emptyFailure.json().code, 'COMMAND_FAILED');
  const otherExit = await diagnose(` WARN  Slow request\n${report}`, 2);
  assert.equal(otherExit.statusCode, 502);
  assert.equal(otherExit.json().code, 'COMMAND_FAILED');
  const npm = await diagnose(` WARN  Slow request\n${report}`, 1, 'npm');
  assert.equal(npm.statusCode, 502);
  assert.equal(npm.json().code, 'INVALID_OUTPUT');
});

test('pnpm registry authentication failures return an actionable error without exposing command output', async (t) => {
  const { diagnose } = await fixture(t);
  for (const code of ['401', '403']) {
    for (const prefix of ['', launcherWarning]) {
      const response = await diagnose(
        `${prefix}[ERR_PNPM_FETCH_${code}] GET private-registry-do-not-expose\nNo authorization header was set for the request.\n`,
      );
      assert.equal(response.statusCode, 502);
      const body = ErrorResponse.parse(response.json());
      assert.equal(
        body.code,
        code === '401'
          ? 'REGISTRY_AUTHENTICATION_FAILED'
          : 'REGISTRY_ACCESS_DENIED',
      );
      assert.match(body.error, /registry credential/);
      assert.equal(response.body.includes('private-'), false);
    }
  }
});
