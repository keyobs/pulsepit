import { execFile } from 'node:child_process';
import { createHash, type KeyObject, sign } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createCommandEnvironment } from '../processes/command-environment.service.js';
import { inspectRepositoryHooks } from './git-hooks.service.js';

const execute = promisify(execFile);
export const checksAdapterPath = fileURLToPath(
  new URL(
    '../../../../../scripts/hooks/pulsepit-pre-push.mjs',
    import.meta.url,
  ),
);
export type ChecksEvidence = {
  commit: string;
  ref: string;
  policyDigest: string;
};
export async function checksAdapterDigest(): Promise<string> {
  return createHash('sha256')
    .update(await readFile(checksAdapterPath))
    .digest('hex');
}
async function regularFile(path: string): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
    throw new Error('Unsupported managed hook.');
  return readFile(path);
}
export async function managedChecksHook(path: string): Promise<boolean> {
  try {
    const directory = await lstat(join(path, '.husky'));
    if (!directory.isDirectory() || directory.isSymbolicLink()) return false;
    const hooks = await inspectRepositoryHooks(path);
    const hook = hooks.hooks[2];
    if (hooks.error || hook.file.state !== 'executable') return false;
    const script = hook.husky?.script ?? hook.file;
    if (
      !script.path ||
      !['executable', 'not_executable'].includes(script.state)
    )
      return false;
    const wrapper = (await regularFile(script.path))
      .toString('utf8')
      .replace(/\r\n/g, '\n')
      .trim();
    if (
      !/^#!(?:\/usr\/bin\/env sh|\/bin\/sh)\n\s*exec node \.husky\/pulsepit-pre-push\.mjs "\$@"$/.test(
        wrapper,
      )
    )
      return false;
    const digest = createHash('sha256')
      .update(await regularFile(join(path, '.husky/pulsepit-pre-push.mjs')))
      .digest('hex');
    return digest === (await checksAdapterDigest());
  } catch {
    return false;
  }
}
export async function verifyChecksContext(
  path: string,
  branch: string,
  evidence: ChecksEvidence,
): Promise<boolean> {
  try {
    const run = async (args: string[]) =>
      (
        await execute('git', args, {
          cwd: path,
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          env: { ...createCommandEnvironment('git'), GIT_NO_LAZY_FETCH: '1' },
        })
      ).stdout.trim();
    if (
      evidence.ref !== `refs/heads/${branch}` ||
      (await run(['symbolic-ref', '--quiet', 'HEAD'])) !== evidence.ref ||
      (await run(['rev-parse', '--verify', 'HEAD'])) !== evidence.commit ||
      (await run(['rev-parse', '--verify', evidence.ref])) !==
        evidence.commit ||
      (await run(['status', '--porcelain', '--untracked-files=all'])) !== ''
    )
      return false;
    const digest = createHash('sha256')
      .update(await regularFile(join(path, '.pulsepit/git-policy.json')))
      .digest('hex');
    return digest === evidence.policyDigest;
  } catch {
    return false;
  }
}
export type ChecksProof = {
  commit: string;
  branch: string;
  environment: NodeJS.ProcessEnv;
  dispose: () => Promise<void>;
};
export async function createChecksProof(
  path: string,
  branch: string,
  evidence: ChecksEvidence,
  privateKey: KeyObject,
  publicKey: KeyObject,
): Promise<ChecksProof> {
  const directory = await mkdtemp(join(tmpdir(), 'pulsepit-checks-proof-'));
  try {
    const payload = {
      version: 1,
      path: await realpath(path),
      ref: evidence.ref,
      commit: evidence.commit,
      policyDigest: evidence.policyDigest,
      expiresAt: Date.now() + 60_000,
    };
    const body = JSON.stringify(payload);
    const proofPath = join(directory, 'proof.json');
    await writeFile(
      proofPath,
      JSON.stringify({
        body,
        signature: sign(null, Buffer.from(body), privateKey).toString('base64'),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    return {
      commit: evidence.commit,
      branch,
      environment: {
        PULSEPIT_CHECKS_PROOF: proofPath,
        PULSEPIT_CHECKS_PUBLIC_KEY: publicKey
          .export({ format: 'der', type: 'spki' })
          .toString('base64'),
      },
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
