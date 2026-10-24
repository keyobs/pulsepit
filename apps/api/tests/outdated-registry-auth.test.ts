import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  ErrorResponse,
  OutdatedResponse,
  RegistryDiagnosticCode,
} from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';
import { registryDiagnostic } from '../src/services/packages/registry-diagnostic.service.js';

type Case = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  versionFail?: boolean;
};
const secret = 'private-token-do-not-expose';
const privateUrl = `https://user:${secret}@private-registry.invalid/package?token=${secret}`;
const packet = (value: unknown) => JSON.stringify(value);
const report = packet({ library: { current: '1', wanted: '2', latest: '3' } });
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-registry-auth-'));
  const path = join(root, 'project');
  const bin = join(root, 'bin');
  await mkdir(join(path, '.git'), { recursive: true });
  await mkdir(bin);
  const previousPath = process.env.PATH;
  const script = join(bin, 'manager.cjs');
  await writeFile(
    script,
    `
const fs=require('node:fs');const fixture=JSON.parse(fs.readFileSync('fixture.json','utf8'));const args=process.argv.slice(2);
if(args[0]==='--version'&&!fixture.versionFail)fs.writeSync(1,fixture.modern?'4.9.2':'1.22.22');
else if(args[0]==='info')fs.writeSync(1,JSON.stringify({value:'project@workspace:.',children:{Dependencies:[{descriptor:'library@npm:^1',locator:'library@npm:1'}]}}));
else{fs.writeSync(1,fixture.stdout??'');fs.writeSync(2,fixture.stderr??'');process.exitCode=fixture.exitCode??1;}
`,
  );
  for (const manager of ['npm', 'pnpm', 'yarn'])
    await writeFile(
      join(bin, manager),
      `#!/bin/sh\nunset NODE_TEST_CONTEXT\nexec "${process.execPath}" "${script}" "$@"\n`,
      { mode: 0o755 },
    );
  process.env.PATH = `${bin}:${previousPath ?? ''}`;
  const app = buildApp({ port: 3001, scanPaths: [root] });
  app.log.level = 'silent';
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const diagnose = async (
    manager: 'npm' | 'pnpm' | 'classic' | 'modern',
    value: Case,
  ) => {
    await writeFile(
      join(path, 'package.json'),
      packet({
        packageManager: `${['classic', 'modern'].includes(manager) ? 'yarn' : manager}@1.0.0`,
      }),
    );
    await writeFile(
      join(path, 'fixture.json'),
      packet({ ...value, modern: manager === 'modern' }),
    );
    return app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path },
    });
  };
  return { path, diagnose };
}
function assertPrivate(body: string) {
  for (const text of [
    secret,
    'private-registry.invalid',
    'Authorization',
    'Bearer',
  ])
    assert.equal(body.includes(text), false);
}

test('npm and pnpm report explicit registry failures from structured JSON or command codes in either stream', async (t) => {
  const { path, diagnose } = await fixture(t);
  const cases = [
    [
      'npm',
      { stdout: packet({ error: { code: 'E401', summary: privateUrl } }) },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
    [
      'npm',
      {
        stderr: `npm ERR! code E403\n${privateUrl}\nAuthorization: Bearer ${secret}`,
        exitCode: 2,
      },
      'REGISTRY_ACCESS_DENIED',
    ],
    [
      'npm',
      { stderr: `npm error code ENEEDAUTH\n${privateUrl}` },
      'REGISTRY_CREDENTIALS_MISSING',
    ],
    [
      'pnpm',
      { stdout: `[ERR_PNPM_FETCH_401] GET ${privateUrl}\n` },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
    [
      'pnpm',
      { stderr: ` ERR_PNPM_FETCH_403  GET ${privateUrl}`, stdout: report },
      'REGISTRY_ACCESS_DENIED',
    ],
    [
      'pnpm',
      {
        stdout: ` WARN  Slow request\n${packet({ error: { code: 'ERR_PNPM_FETCH_401', message: privateUrl } })}`,
      },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
    [
      'npm',
      {
        stdout: packet({ error: { code: 'E401', summary: privateUrl } }),
        exitCode: 0,
      },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
  ] as const;
  for (const [manager, value, code] of cases) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().path, path);
    assert.equal(
      RegistryDiagnosticCode.parse(ErrorResponse.parse(response.json()).code),
      code,
    );
    assertPrivate(response.body);
    assert.equal(OutdatedResponse.safeParse(response.json()).success, false);
    assert.match(response.json().error, /registry credential/);
  }
});

test('Classic and Modern classify missing credentials, rejected authentication and forbidden requests before generic parsing', async (t) => {
  const { diagnose } = await fixture(t);
  const cases = [
    [
      'classic',
      {
        stderr: packet({
          type: 'error',
          data: `${privateUrl}: Request failed "401 Unauthorized"`,
        }),
      },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
    [
      'classic',
      {
        stdout: packet({
          type: 'error',
          data: `${privateUrl}: Request failed "403 Forbidden"`,
        }),
      },
      'REGISTRY_ACCESS_DENIED',
    ],
    [
      'classic',
      {
        stderr: `Error: Failed to replace env in config: \${NPM_TOKEN}`,
        versionFail: true,
      },
      'REGISTRY_CREDENTIALS_MISSING',
    ],
    [
      'modern',
      {
        stderr:
          'Usage Error: Environment variable not found (NODE_AUTH_TOKEN) in private-config',
        versionFail: true,
      },
      'REGISTRY_CREDENTIALS_MISSING',
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 33,
          displayName: 'YN0033',
          data: privateUrl,
        }),
      },
      'REGISTRY_CREDENTIALS_MISSING',
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 41,
          displayName: 'YN0041',
          data: privateUrl,
        }),
        exitCode: 0,
      },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
    [
      'modern',
      {
        stderr: packet({
          type: 'error',
          name: 35,
          displayName: 'YN0035',
          data: '  Response Code: 403 (Forbidden)',
        }),
      },
      'REGISTRY_ACCESS_DENIED',
    ],
    [
      'modern',
      { stderr: `➤ YN0041: Invalid authentication ${privateUrl}` },
      'REGISTRY_AUTHENTICATION_FAILED',
    ],
  ] as const;
  for (const [manager, value, code] of cases) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502);
    assert.equal(ErrorResponse.parse(response.json()).code, code);
    assertPrivate(response.body);
  }
});

test('successful reports and incidental auth strings are not reclassified; unrelated errors stay generic and private', async (t) => {
  const { diagnose } = await fixture(t);
  for (const manager of ['npm', 'pnpm'] as const) {
    const response = await diagnose(manager, {
      stdout: packet({
        E403: { current: '401', wanted: '403', latest: '404' },
      }),
      exitCode: 1,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      OutdatedResponse.parse(response.json()).dependencies[0].name,
      'E403',
    );
  }
  for (const [manager, value, expected] of [
    [
      'npm',
      { stderr: `npm error code EACCES\n${privateUrl}`, exitCode: 2 },
      'COMMAND_FAILED',
    ],
    [
      'pnpm',
      { stdout: `ERR_PNPM_FETCH_404 GET ${privateUrl}` },
      'INVALID_OUTPUT',
    ],
    [
      'classic',
      { stderr: packet({ type: 'error', data: privateUrl }) },
      'COMMAND_FAILED',
    ],
    [
      'modern',
      {
        stdout: packet({
          type: 'error',
          name: 35,
          data: 'Response Code: 500 (Server Error)',
        }),
      },
      'REGISTRY_UNAVAILABLE',
    ],
  ] as const) {
    const response = await diagnose(manager, value);
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().code, expected);
    assertPrivate(response.body);
  }
  assert.equal(
    registryDiagnostic(
      'npm',
      packet({ error: { code: 'E404', summary: 'E401' } }),
      '',
      true,
    ),
    null,
  );
  assert.equal(
    registryDiagnostic('pnpm', 'WARN retrying ERR_PNPM_FETCH_401', '', true),
    null,
  );
  assert.equal(
    registryDiagnostic(
      'yarn',
      packet({ type: 'warning', name: 41, data: privateUrl }),
      '',
      true,
    ),
    null,
  );
  assert.equal(
    registryDiagnostic(
      'yarn',
      packet({
        type: 'error',
        name: 35,
        data: 'Response Code: 404 (Not Found)',
      }),
      '',
      true,
    ),
    null,
  );
});
