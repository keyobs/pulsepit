import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type GitStatus, getGitStatus } from './git.service.js';

export interface Repository {
  name: string;
  path: string;
  git: GitStatus | null;
  gitError: string | null;
}

export async function findRepositories(
  scanPath: string | string[],
): Promise<Repository[]> {
  const paths = Array.isArray(scanPath) ? scanPath : [scanPath];
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
  const repositories: Repository[] = [];

  for (const path of uniquePaths) {
    repositories.push(...(await scanDirectory(path)));
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanDirectory(scanPath: string): Promise<Repository[]> {
  const entries = await readdir(scanPath, { withFileTypes: true });
  const repositories: Repository[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const repositoryPath = join(scanPath, entry.name);

    try {
      // Git worktrees use a .git file instead of a directory.
      const gitEntry = await lstat(join(repositoryPath, '.git'));
      if (gitEntry.isDirectory() || gitEntry.isFile()) {
        let git: GitStatus | null = null;
        let gitError: string | null = null;
        try {
          git = await getGitStatus(repositoryPath);
        } catch {
          gitError = 'Unable to read Git status for this repository.';
        }
        repositories.push({
          name: entry.name,
          path: repositoryPath,
          git,
          gitError,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}
