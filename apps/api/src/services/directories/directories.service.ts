import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  DirectoryEntry,
  DirectoryListResponse,
} from '@pulsepit/contracts';
import { hasGitMarker } from '../repositories/repositories.service.js';

export const MAX_DIRECTORY_ENTRIES = 500;

export class DirectoryListError extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const statusByCode: Record<string, 403 | 404> = {
  ENOENT: 404,
  ENOTDIR: 404,
  EACCES: 403,
  EPERM: 403,
};

export async function listDirectories(
  requested: string | undefined,
  home = homedir(),
): Promise<DirectoryListResponse> {
  if (requested !== undefined && !isAbsolute(requested.trim()))
    throw new DirectoryListError(
      400,
      'INVALID_PATH',
      'Absolute path required.',
    );
  const path = resolve(requested?.trim() || home);

  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    const status = statusByCode[code];
    if (!status) throw error;
    throw new DirectoryListError(status, code, `Cannot read ${path}.`);
  }

  // Symlinks are not followed: Dirent.isDirectory() is false for them.
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const kept = names.slice(0, MAX_DIRECTORY_ENTRIES);

  const directories: DirectoryEntry[] = await Promise.all(
    kept.map(async (name) => {
      const child = join(path, name);
      const isGitRepo = await hasGitMarker(child).catch(() => false);
      return { name, path: child, isGitRepo };
    }),
  );

  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    directories,
    truncated: names.length > kept.length,
  };
}
