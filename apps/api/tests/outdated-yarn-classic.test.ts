import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { ErrorResponse, OutdatedResponse } from '@pulsepit/contracts';
import { buildApp } from '../src/app.js';

const packet = (type: string, data: unknown) => JSON.stringify({ type, data });
const head = ['Package', 'Current', 'Wanted', 'Latest', 'Package Type', 'URL'];
const workspaceHead = [
  'Package',
  'Current',
  'Wanted',
  'Latest',
  'Workspace',
  'Package Type',
  'URL',
];
const row = [
  '@scope/library',
  '1.0.0',
  '1.2.0',
  '2.0.0',
  'dependencies',
  'https://example.invalid/package',
];
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-yarn-classic-'));
  const path = join(root, 'project');
  const bin = join(root, 'bin');
  await mkdir(join(path, '.git'), { recursive: true });
  await mkdir(bin);
  const previous = {
    PATH: process.env.PATH,
    NPM_TOKEN: process.env.NPM_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };
  process.env.PATH = `${bin}:${previous.PATH ?? ''}`;
  process.env.NPM_TOKEN = 'fixture-registry-token';
  process.env.GITHUB_TOKEN = 'fixture-api-token';
  const manifest = JSON.stringify({
    private: true,
    packageManager: 'yarn@1.22.22',
    scripts: { preoutdated: 'exit 99', postoutdated: 'exit 99' },
  });
  await writeFile(join(path, 'package.json'), manifest);
  await writeFile(join(path, 'yarn.lock'), '# yarn lockfile v1\n');
  const script = join(bin, 'manager.cjs');
  await writeFile(
    script,
    `
const assert=require('node:assert/strict');const fs=require('node:fs');
const fixture=JSON.parse(fs.readFileSync('fixture.json','utf8'));const args=process.argv.slice(2);
assert.ok(!process.env.GITHUB_TOKEN && !process.env.VERCEL_TOKEN);
assert.equal(process.env.NPM_TOKEN,'fixture-registry-token');
assert.equal(process.env.YARN_ENABLE_SCRIPTS,'false');assert.equal(process.env.COREPACK_ENABLE_NETWORK,'0');
fs.appendFileSync('commands.jsonl',JSON.stringify(args)+'\\n');
if(args[0]==='--version'){assert.deepEqual(args,['--version']);fs.writeSync(1,fixture.version??'1.22.22');}
else if(fixture.version==='4.9.2'){assert.deepEqual(args,['info','--all','--json']);fs.writeSync(1,JSON.stringify({value:'project@workspace:.',children:{Dependencies:[]}}));}
else {assert.deepEqual(args,['outdated','--json','--ignore-scripts','--non-interactive']);fs.writeSync(1,fixture.output??'');fs.writeSync(2,fixture.stderr??'');process.exitCode=fixture.exitCode??0;}
`,
  );
  await writeFile(
    join(bin, 'yarn'),
    `#!/bin/sh\nunset NODE_TEST_CONTEXT\nexec "${process.execPath}" "${script}" "$@"\n`,
    { mode: 0o755 },
  );
  const app = buildApp({ port: 3001, scanPaths: [root] });
  app.log.level = 'silent';
  t.after(async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function diagnose(
    output = '',
    exitCode = 0,
    options: { stderr?: string; version?: string } = {},
  ) {
    await writeFile(
      join(path, 'fixture.json'),
      JSON.stringify({ output, exitCode, ...options }),
    );
    return app.inject({
      method: 'POST',
      url: '/api/repositories/outdated',
      payload: { path },
    });
  }
  return { path, manifest, diagnose };
}

test('Classic normalizes standalone and workspace tables, preserves repeated packages and does not run lifecycle scripts', async (t) => {
  const { path, manifest, diagnose } = await fixture(t);
  const first = await diagnose(
    [
      packet('info', 'Color legend'),
      packet('table', { head, body: [row] }),
      packet('finished', 12),
    ].join('\n'),
    1,
  );
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(OutdatedResponse.parse(first.json()), {
    path,
    packageManager: 'yarn',
    dependencies: [
      {
        name: '@scope/library',
        current: '1.0.0',
        wanted: '1.2.0',
        latest: '2.0.0',
        dependent: null,
        location: path,
      },
    ],
    error: null,
  });
  const body = [
    ['shared', '1', '2', '3', 'api', 'dependencies', ''],
    ['shared', '2', '2', '3', 'web', 'devDependencies', ''],
  ];
  const workspaces = await diagnose(
    packet('table', { head: workspaceHead, body }),
    1,
  );
  assert.equal(workspaces.statusCode, 200);
  const entries = OutdatedResponse.parse(workspaces.json()).dependencies;
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => [entry.dependent, entry.location]),
    [
      ['api', null],
      ['web', null],
    ],
  );
  assert.equal(await readFile(join(path, 'package.json'), 'utf8'), manifest);
  assert.equal(
    await readFile(join(path, 'yarn.lock'), 'utf8'),
    '# yarn lockfile v1\n',
  );
  assert.deepEqual(
    (await readFile(join(path, 'commands.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    [
      ['--version'],
      ['outdated', '--json', '--ignore-scripts', '--non-interactive'],
      ['--version'],
      ['outdated', '--json', '--ignore-scripts', '--non-interactive'],
    ],
  );
});

test('Classic accepts empty successful reports and lockfile detection; actual executable version keeps Modern on its own flow', async (t) => {
  const { path, diagnose } = await fixture(t);
  await writeFile(join(path, 'package.json'), '{}');
  for (const output of [
    '',
    packet('finished', 0),
    packet('table', { head, body: [] }),
  ]) {
    const response = await diagnose(output, 0);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(OutdatedResponse.parse(response.json()).dependencies, []);
  }
  const modern = await diagnose('', 0, { version: '4.9.2' });
  assert.equal(modern.statusCode, 200);
  assert.deepEqual(OutdatedResponse.parse(modern.json()).dependencies, []);
  const unsupported = await diagnose('', 0, { version: '0.27.5' });
  assert.equal(unsupported.statusCode, 422);
  assert.equal(unsupported.json().code, 'PACKAGE_MANAGER');
});

test('Classic rejects malformed tables and fatal errors without exposing registry credentials or accepting empty failed commands', async (t) => {
  const { diagnose } = await fixture(t);
  for (const output of [
    'not json',
    packet('table', { head: ['Package', 'Latest'], body: [['name', '2']] }),
    packet('table', { head, body: [row.slice(0, -1)] }),
    packet('table', { head, body: [[null, ...row.slice(1)]] }),
    packet('table', {
      head,
      body: [[...row.slice(0, 2), '', ...row.slice(3)]],
    }),
    packet('unknown', {}),
    `${packet('table', { head, body: [row] })}\n${packet('table', { head, body: [row] })}`,
  ]) {
    const response = await diagnose(output, 1);
    assert.equal(response.statusCode, 502);
    assert.equal(ErrorResponse.parse(response.json()).code, 'INVALID_OUTPUT');
  }
  for (const [output, exitCode, stderr] of [
    ['', 1, ''],
    [packet('table', { head, body: [] }), 1, ''],
    [packet('error', 'private-registry-token'), 1, ''],
    [
      packet('table', { head, body: [row] }),
      1,
      packet('error', 'private-registry-token'),
    ],
    [packet('table', { head, body: [row] }), 2, 'private-registry-token'],
  ] as const) {
    const response = await diagnose(output, exitCode, { stderr });
    assert.equal(response.statusCode, 502);
    assert.equal(ErrorResponse.parse(response.json()).code, 'COMMAND_FAILED');
    assert.equal(response.body.includes('private-registry-token'), false);
    assert.equal(response.body.includes('fixture-api-token'), false);
    assert.equal(OutdatedResponse.safeParse(response.json()).success, false);
  }
});
