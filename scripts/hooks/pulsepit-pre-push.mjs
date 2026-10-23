#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function printError(message) {
  writeSync(2, `${message}\n`);
}
function printInfo(message) {
  writeSync(1, `${message}\n`);
}
const limit = 64 * 1024;
const scripts = { 'lint-fix': 'lint:fix', 'test-run': 'test:run' };
class PushPolicyError extends Error {}
function reject(message, code = 'INVALID_PUSH_POLICY') {
  const error = new PushPolicyError(message);
  error.code = code;
  throw error;
}
function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  }).trim();
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value, allowed) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    reject('Invalid push policy declaration.');
}
function rule(value) {
  keys(value, ['directPush', 'requiredChecks']);
  if (!['allowed', 'forbidden', 'unknown'].includes(value.directPush))
    reject('Invalid push policy rule.');
  const checks = value.requiredChecks;
  if (
    checks !== null &&
    (!Array.isArray(checks) ||
      checks.length > 64 ||
      new Set(checks).size !== checks.length ||
      checks.some(
        (id) =>
          typeof id !== 'string' ||
          id.length > 64 ||
          !/^[a-z0-9][a-z0-9-]*$/.test(id),
      ))
  )
    reject('Invalid required checks.');
  return value;
}
export function validateDeclaration(value) {
  keys(value, ['version', 'remote', 'default', 'branches']);
  if (value.version !== 1 || value.remote !== 'origin')
    reject('Unsupported push policy declaration.');
  if (Object.hasOwn(value, 'default')) rule(value.default);
  if (Object.hasOwn(value, 'branches')) {
    if (!object(value.branches)) reject('Invalid branch policies.');
    for (const [branch, entry] of Object.entries(value.branches)) {
      if (branch === 'HEAD' || branch === '__proto__' || branch.startsWith('-'))
        reject('Invalid policy branch.');
      try {
        git('check-ref-format', `refs/heads/${branch}`);
      } catch {
        reject('Invalid policy branch.');
      }
      rule(entry);
    }
  }
  return value;
}
function boundedRead(fd) {
  const buffer = Buffer.alloc(limit + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(fd, buffer, length, buffer.length - length, null);
    if (!count) break;
    length += count;
  }
  if (length > limit) reject('Push policy input is too large.');
  return new TextDecoder('utf-8', { fatal: true }).decode(
    buffer.subarray(0, length),
  );
}
function declaration() {
  const directory = lstatSync('.pulsepit');
  const path = '.pulsepit/git-policy.json';
  const file = lstatSync(path);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    !file.isFile() ||
    file.isSymbolicLink()
  )
    reject('Unsupported push policy file.');
  const fd = openSync(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  let raw;
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.ino !== file.ino ||
      opened.dev !== file.dev ||
      opened.size > limit
    )
      reject('Unsupported push policy file.');
    raw = boundedRead(fd);
  } finally {
    closeSync(fd);
  }
  return {
    policy: validateDeclaration(JSON.parse(raw)),
    digest: createHash('sha256').update(raw).digest('hex'),
  };
}
function parseUpdates(input) {
  if (!input.trim()) return [];
  return input
    .trim()
    .split('\n')
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4) reject('Invalid pre-push reference input.');
      const [localRef, oid, remoteRef, remoteOid] = fields;
      if (
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) ||
        remoteOid.length !== oid.length ||
        !/^[a-f0-9]+$/.test(remoteOid)
      )
        reject('Invalid pre-push object input.');
      try {
        git('check-ref-format', remoteRef);
        if (localRef !== '(delete)') git('check-ref-format', localRef);
      } catch {
        reject('Unsupported pre-push reference.');
      }
      return { localRef, oid, remoteRef };
    });
}
function packageManager() {
  for (const [file, command, prefix] of [
    ['pnpm-lock.yaml', 'pnpm', ['run']],
    ['yarn.lock', 'yarn', []],
    ['bun.lockb', 'bun', ['run']],
    ['bun.lock', 'bun', ['run']],
  ]) {
    try {
      lstatSync(file);
      return { command, prefix };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { command: 'npm', prefix: ['run'] };
}
function runScript(manager, script) {
  const result = spawnSync(manager.command, [...manager.prefix, script], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return result.status === 0 && !result.error && !result.signal;
}
export function runPrePush(remote, input, report = () => {}) {
  const initial = declaration();
  if (remote !== initial.policy.remote)
    reject('No push policy is declared for this remote.');
  const updates = parseUpdates(input);
  if (updates.length === 0) return;
  const required = new Set();
  const checkedUpdates = [];
  for (const update of updates) {
    if (!update.remoteRef.startsWith('refs/heads/')) continue;
    const name = update.remoteRef.slice('refs/heads/'.length);
    const effective = Object.hasOwn(initial.policy.branches ?? {}, name)
      ? initial.policy.branches[name]
      : initial.policy.default;
    if (effective?.directPush === 'forbidden')
      reject('Direct push to a selected branch is forbidden.');
    if (effective?.requiredChecks?.length) {
      checkedUpdates.push(update);
      for (const id of effective.requiredChecks) required.add(id);
    }
  }
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const hasScript = (name) =>
    typeof manifest.scripts?.[name] === 'string' &&
    manifest.scripts[name].trim().length > 0;
  for (const id of required) {
    if (!Object.hasOwn(scripts, id) || !hasScript(scripts[id]))
      reject(
        'A required check has no supported package script.',
        'CHECK_RUNNER_UNAVAILABLE',
      );
  }
  let context;
  function verifyContext() {
    if (!context) return;
    if (
      git('symbolic-ref', '--quiet', 'HEAD') !== context.ref ||
      git('rev-parse', '--verify', 'HEAD') !== context.oid ||
      git('status', '--porcelain', '--untracked-files=all') !== ''
    )
      reject(
        'The tested commit or working tree changed. Review and commit changes before pushing.',
        'CHECK_CONTEXT_MISMATCH',
      );
  }
  if (checkedUpdates.length) {
    context = {
      ref: git('symbolic-ref', '--quiet', 'HEAD'),
      oid: git('rev-parse', '--verify', 'HEAD'),
    };
    if (
      checkedUpdates.some(
        (update) =>
          update.localRef !== context.ref || update.oid !== context.oid,
      )
    )
      reject(
        'Required checks must run on the current branch and pushed commit.',
        'CHECK_CONTEXT_MISMATCH',
      );
    verifyContext();
  }
  const manager = packageManager();
  if (hasScript('lint:fix')) {
    printInfo('Running lint fix before push...');
    report({ checkId: 'lint-fix', status: 'running', required: true });
    const passed = runScript(manager, 'lint:fix');
    report({
      checkId: 'lint-fix',
      status: passed ? 'passed' : 'failed',
      required: true,
    });
    if (!passed) reject('Lint failed. Push aborted.', 'CHECK_FAILED');
    verifyContext();
  }
  if (hasScript('test:run')) {
    printInfo('Running tests before push...');
    report({
      checkId: 'test-run',
      status: 'running',
      required: required.has('test-run'),
    });
    const passed = runScript(manager, 'test:run');
    report({
      checkId: 'test-run',
      status: passed ? 'passed' : 'failed',
      required: required.has('test-run'),
    });
    if (!passed) {
      if (required.has('test-run'))
        reject('Required tests failed. Push aborted.', 'CHECK_FAILED');
      printError('Tests failed; this branch has no mandatory test check.');
    }
  }
  verifyContext();
  if (declaration().digest !== initial.digest)
    reject(
      'The push policy changed during checks. Retry after reviewing it.',
      'CHECK_CONTEXT_MISMATCH',
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const reporting = process.argv[2] === '--report-checks';
  const report = reporting
    ? (event) => writeSync(3, `${JSON.stringify(event)}\n`)
    : () => {};
  try {
    runPrePush(process.argv[reporting ? 3 : 2], boundedRead(0), report);
    report({ status: 'succeeded' });
  } catch (error) {
    report({
      status: 'failed',
      code:
        error instanceof PushPolicyError ? error.code : 'INVALID_PUSH_POLICY',
    });
    printError(
      error instanceof PushPolicyError
        ? error.message
        : 'Unable to read a valid local push policy or check context.',
    );
    process.exitCode = 1;
  }
}
