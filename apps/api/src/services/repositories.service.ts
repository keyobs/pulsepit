import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type GitStatus, getGitStatus } from './git.service.js';
import { getPackageVersions, type PackageVersions } from './package.service.js';

export interface Repository {
  name: string;
  path: string;
  git: GitStatus | null;
  gitError: string | null;
  versions: PackageVersions;
}

export interface ScanError {
  path: string;
  code: string;
  message: string;
}

export interface ScanResult {
  repositories: Repository[];
  scanErrors: ScanError[];
}

function describeScanError(path: string, error: unknown): ScanError {
  const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
  const messages: Record<string, string> = {
    ENOENT: 'Directory does not exist.',
    ENOTDIR: 'Scan path is not a directory.',
    EACCES: 'Permission denied while scanning directory.',
    EPERM: 'Operation not permitted while scanning directory.',
  };
  return { path, code, message: messages[code] ?? 'Unable to scan directory.' };
}

export async function findRepositories(
  scanPath: string | string[],
): Promise<ScanResult> {
  const paths = Array.isArray(scanPath) ? scanPath : [scanPath];
  const uniquePaths = [...new Set(paths.map((path) => resolve(path)))];
  const repositories: Repository[] = [];
  const scanErrors: ScanError[] = [];

  for (const path of uniquePaths) {
    try {
      repositories.push(...(await scanDirectory(path, scanErrors)));
    } catch (error) {
      scanErrors.push(describeScanError(path, error));
    }
  }

  return {
    repositories: repositories.sort((a, b) => a.name.localeCompare(b.name)),
    scanErrors,
  };
}

async function scanDirectory(
  scanPath: string,
  scanErrors: ScanError[],
): Promise<Repository[]> {
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
          versions: await getPackageVersions(repositoryPath),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        scanErrors.push(describeScanError(repositoryPath, error));
      }
    }
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}
