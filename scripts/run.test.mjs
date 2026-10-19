import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
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
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

// Isolate the runner from actual servers and compilers while exercising its
// subprocess ordering and shutdown with real child processes.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pulsepit-runner-'));
  const children = [];
  t.after(async () => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  const runner = join(root, 'scripts', 'run.mjs');
  await copyFile(new URL('./run.mjs', import.meta.url), runner);
  const eventsFile = join(root, 'events.jsonl');
  const env = { ...process.env, PULSEPIT_RUNNER_EVENTS: eventsFile };
  const fakeBinary = `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');
const workspace = basename(process.cwd());
const events = process.env.PULSEPIT_RUNNER_EVENTS;
const record = (event) => appendFileSync(events, JSON.stringify(event) + '\\n');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const serve = basename(process.argv[1]) === 'vite' && !args.includes('build');
const artifact = join(dirname(events), 'packages/contracts/dist/index.js');
if (workspace === 'contracts' && !watch) {
  record('contracts:build');
  if (process.env.PULSEPIT_RUNNER_FAIL_BUILD === '1') process.exit(7);
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, 'export const ready = true;');
  record('contracts:built');
} else {
  if (!existsSync(artifact)) throw new Error('Contracts were not built first.');
  const operation = watch ? 'watch' : serve ? 'serve' : args.includes('--noEmit') ? 'check-types' : 'build';
  record(workspace + ':' + operation);
  if (watch || serve) {
    process.on('SIGTERM', () => { record(workspace + ':stopped'); process.exit(0); });
    setInterval(() => {}, 1000);
  }
}
`;
  for (const [workspace, binaries] of [
    ['packages/contracts', ['tsc']],
    ['apps/api', ['tsc', 'tsx']],
    ['apps/web', ['tsc', 'vite']],
  ]) {
    const bin = join(root, workspace, 'node_modules', '.bin');
    await mkdir(bin, { recursive: true });
    for (const binary of binaries) {
      await writeFile(join(bin, binary), fakeBinary, { mode: 0o755 });
    }
  }
  async function events() {
    try {
      return (await readFile(eventsFile, 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  return { root, runner, env, events, children };
}

test('dev:web builds contracts first and stops its watcher with the server', {
  timeout: 10_000,
}, async (t) => {
  const context = await fixture(t);
  const child = spawn(process.execPath, [context.runner, 'dev:web'], {
    cwd: context.root,
    env: context.env,
    detached: true,
    stdio: 'ignore',
  });
  context.children.push(child);
  const exited = once(child, 'exit');
  let events;
  for (let attempts = 0; attempts < 200; attempts++) {
    events = await context.events();
    if (events.includes('contracts:watch') && events.includes('web:serve'))
      break;
    assert.equal(
      child.exitCode,
      null,
      'The development runner exited too early.',
    );
    await delay(20);
  }
  assert.ok(events.includes('contracts:watch'));
  assert.ok(events.includes('web:serve'));
  assert.ok(
    events.indexOf('contracts:built') < events.indexOf('contracts:watch'),
  );
  assert.ok(events.indexOf('contracts:built') < events.indexOf('web:serve'));
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
  const stopped = await context.events();
  assert.ok(stopped.includes('contracts:stopped'));
  assert.ok(stopped.includes('web:stopped'));
});

test('a failed initial contract build prevents starting development processes', async (t) => {
  const context = await fixture(t);
  await assert.rejects(
    execute(process.execPath, [context.runner, 'dev:web'], {
      cwd: context.root,
      env: { ...context.env, PULSEPIT_RUNNER_FAIL_BUILD: '1' },
    }),
    (error) => error.code === 1,
  );
  assert.deepEqual(await context.events(), ['contracts:build']);
});

test('build and check-types compile contracts before their consumers', async (t) => {
  for (const command of ['build', 'check-types']) {
    await t.test(command, async (r) => {
      const context = await fixture(r);
      await execute(process.execPath, [context.runner, command], {
        cwd: context.root,
        env: context.env,
      });
      const events = await context.events();
      assert.deepEqual(events.slice(0, 2), [
        'contracts:build',
        'contracts:built',
      ]);
      assert.ok(
        events.includes(command === 'build' ? 'api:build' : 'api:check-types'),
      );
      assert.ok(events.includes('web:check-types'));
      if (command === 'build') assert.ok(events.includes('web:build'));
    });
  }
});
