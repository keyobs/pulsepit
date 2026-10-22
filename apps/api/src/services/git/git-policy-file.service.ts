import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { GitPolicyFile } from '@pulsepit/contracts';
import { validateGitPolicyBranchName } from './git-policy.service.js';

const maxBytes = 64 * 1024;
export type GitPolicyFileResult =
  | { state: 'missing'; declaration: null; error: null }
  | { state: 'loaded'; declaration: GitPolicyFile; error: null }
  | {
      state: 'invalid';
      declaration: null;
      error: { code: 'INVALID_PUSH_POLICY'; message: string };
    };

// Reads a fixed declaration and rejects links; never executes repo code.
export async function readRepositoryGitPolicyFile(
  repositoryPath: string,
): Promise<GitPolicyFileResult> {
  let fileObserved = false;
  try {
    const directory = join(repositoryPath, '.pulsepit');
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw new Error('Unsupported policy directory.');
    const path = join(directory, 'git-policy.json');
    const fileStat = await lstat(path);
    fileObserved = true;
    if (!fileStat.isFile() || fileStat.isSymbolicLink())
      throw new Error('Unsupported policy file.');
    const handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    let content: string;
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        openedStat.dev !== fileStat.dev ||
        openedStat.ino !== fileStat.ino ||
        openedStat.size > maxBytes
      )
        throw new Error('Unsupported policy file.');
      const buffer = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          size,
          buffer.length - size,
          null,
        );
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      if (size > maxBytes) throw new Error('Policy file too large.');
      content = new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, size),
      );
    } finally {
      await handle.close();
    }
    const raw: unknown = JSON.parse(content);
    const declaration = GitPolicyFile.parse(raw);
    // Reject any lossy record parsing rather than silently discarding a rule.
    const originalBranches = (raw as { branches?: object }).branches;
    if (
      originalBranches &&
      Object.keys(originalBranches).length !==
        Object.keys(declaration.branches).length
    )
      throw new Error('Policy rule was discarded.');
    for (const branch of Object.keys(declaration.branches)) {
      await validateGitPolicyBranchName(branch);
    }
    return { state: 'loaded', declaration, error: null };
  } catch (error) {
    if (!fileObserved && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return { state: 'missing', declaration: null, error: null };
    return {
      state: 'invalid',
      declaration: null,
      error: {
        code: 'INVALID_PUSH_POLICY',
        message: 'Unable to read a valid repository push policy declaration.',
      },
    };
  }
}
