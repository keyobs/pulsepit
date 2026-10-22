import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { createCommandEnvironment } from './command-environment.service.js';

const execute = promisify(execFile);
const hookNames = ['pre-commit', 'commit-msg', 'pre-push'] as const;

interface HookFile {
  path: string;
  state:
    | 'missing'
    | 'executable'
    | 'not_executable'
    | 'unreadable'
    | 'unsupported';
}

export interface RepositoryHooks {
  directory: string | null;
  source: 'default' | 'configured' | null;
  directoryState:
    | 'directory'
    | 'missing'
    | 'not_directory'
    | 'unreadable'
    | 'unsupported'
    | null;
  hooks: {
    name: (typeof hookNames)[number];
    file: HookFile;
    husky: { loader: HookFile; script: HookFile } | null;
  }[];
  error: { code: 'HOOKS_READ_FAILED' | 'TIMEOUT'; message: string } | null;
}

async function inspectFile(path: string): Promise<HookFile> {
  try {
    if (!(await lstat(path)).isFile()) return { path, state: 'unsupported' };
    try {
      await access(path, constants.R_OK);
    } catch {
      return { path, state: 'unreadable' };
    }
    try {
      await access(path, constants.X_OK);
    } catch {
      return { path, state: 'not_executable' };
    }
    return { path, state: 'executable' };
  } catch (error) {
    return {
      path,
      state: ['ENOENT', 'ENOTDIR'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
        ? 'missing'
        : 'unreadable',
    };
  }
}

async function isHuskyWrapper(file: HookFile): Promise<boolean> {
  if (!['executable', 'not_executable'].includes(file.state)) return false;
  const directory = dirname(file.path);
  if (basename(directory) !== '_' || basename(dirname(directory)) !== '.husky')
    return false;
  try {
    const handle = await open(
      file.path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 4096) return false;
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) return false;
      const text = buffer
        .subarray(0, bytesRead)
        .toString('utf8')
        .replace(/\r\n/g, '\n')
        .trim();
      return /^#!(?:\/usr\/bin\/env sh|\/bin\/sh)\n\. "\$\(dirname "\$0"\)\/h"$/.test(
        text,
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export async function inspectRepositoryHooks(
  repositoryPath: string,
): Promise<RepositoryHooks> {
  const deadline = Date.now() + 5_000;
  async function readGit(args: string[]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw Object.assign(new Error('Git read timed out.'), {
        signal: 'SIGKILL',
      });
    return execute('git', args, {
      cwd: repositoryPath,
      timeout: remaining,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
      env: {
        ...createCommandEnvironment('git'),
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
    });
  }
  try {
    const { stdout } = await readGit([
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'hooks',
    ]);
    const directory = stdout.replace(/\r?\n$/, '');
    if (
      !directory ||
      !isAbsolute(directory) ||
      directory.includes('\n') ||
      directory.includes('\0')
    )
      throw new Error('Invalid hooks directory.');
    let source: RepositoryHooks['source'] = 'configured';
    try {
      await readGit(['config', '--get', 'core.hooksPath']);
    } catch (error) {
      if ((error as { code?: unknown }).code !== 1) throw error;
      source = 'default';
    }
    let directoryState: RepositoryHooks['directoryState'];
    try {
      const stat = await lstat(directory);
      directoryState = stat.isSymbolicLink()
        ? 'unsupported'
        : stat.isDirectory()
          ? 'directory'
          : 'not_directory';
    } catch (error) {
      directoryState =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'missing'
          : 'unreadable';
    }
    const hooks: RepositoryHooks['hooks'] = [];
    for (const name of hookNames) {
      const path = join(directory, name);
      const file: HookFile =
        directoryState === 'directory'
          ? await inspectFile(path)
          : {
              path,
              state:
                directoryState === 'missing' ||
                directoryState === 'not_directory'
                  ? 'missing'
                  : directoryState,
            };
      const husky = (await isHuskyWrapper(file))
        ? {
            loader: await inspectFile(join(directory, 'h')),
            script: await inspectFile(join(dirname(directory), name)),
          }
        : null;
      hooks.push({ name, file, husky });
    }
    return { directory, source, directoryState, hooks, error: null };
  } catch (error) {
    const timedOut = (error as { signal?: string }).signal === 'SIGKILL';
    return {
      directory: null,
      source: null,
      directoryState: null,
      hooks: [],
      error: {
        code: timedOut ? 'TIMEOUT' : 'HOOKS_READ_FAILED',
        message: timedOut
          ? 'Reading Git hooks timed out.'
          : 'Unable to inspect Git hooks for this repository.',
      },
    };
  }
}
