import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  type PushLocks,
  Settings,
  type SettingsResponse,
} from '@pulsepit/contracts';
import { validateGitPolicyBranchName } from '../git/git-policy.service.js';

export class SettingsValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

export const defaultSettings = (): Settings => ({
  scanPaths: null,
  rescan: { enabled: false, interval: '1h' },
  pushLocks: { all: false, branches: [], repositories: {} },
});

export function isPushLocked(
  locks: PushLocks,
  repositoryPath: string,
  branch: string,
): boolean {
  if (locks.all || locks.branches.includes(branch)) return true;
  const repository = Object.hasOwn(locks.repositories, repositoryPath)
    ? locks.repositories[repositoryPath]
    : undefined;
  return (
    repository !== undefined &&
    (repository.all || repository.branches.includes(branch))
  );
}

async function validateBranches(branches: string[], field: string) {
  for (const branch of branches) {
    try {
      await validateGitPolicyBranchName(branch);
    } catch {
      throw new SettingsValidationError(
        `Invalid branch name: ${branch}`,
        field,
      );
    }
  }
}

export async function validateSettings(input: unknown): Promise<Settings> {
  const parsed = Settings.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SettingsValidationError(issue.message, issue.path.join('.'));
  }
  const settings = parsed.data;
  if (settings.scanPaths !== null) {
    const paths: string[] = [];
    for (const path of settings.scanPaths) {
      if (!isAbsolute(path))
        throw new SettingsValidationError(
          `Scan path must be absolute: ${path}`,
          'scanPaths',
        );
      const normalized = resolve(path);
      const stat = await lstat(normalized).catch(() => null);
      if (!stat?.isDirectory())
        throw new SettingsValidationError(
          `Scan path is not an accessible directory: ${path}`,
          'scanPaths',
        );
      if (!paths.includes(normalized)) paths.push(normalized);
    }
    settings.scanPaths = paths;
  }
  await validateBranches(settings.pushLocks.branches, 'pushLocks.branches');
  const repositories: PushLocks['repositories'] = {};
  for (const [path, lock] of Object.entries(settings.pushLocks.repositories)) {
    if (!isAbsolute(path))
      throw new SettingsValidationError(
        `Repository path must be absolute: ${path}`,
        'pushLocks.repositories',
      );
    await validateBranches(lock.branches, 'pushLocks.repositories');
    repositories[resolve(path)] = lock;
  }
  settings.pushLocks.repositories = repositories;
  return settings;
}

export class SettingsStore {
  private current = defaultSettings();
  private readonly envScanPaths: string[];
  private writing: Promise<unknown> = Promise.resolve();

  // scanPaths is shared with every route and updated in place.
  constructor(
    private readonly scanPaths: string[],
    private readonly file?: string,
  ) {
    this.envScanPaths = [...scanPaths];
  }

  get settings(): Settings {
    return this.current;
  }

  async load(): Promise<string | null> {
    if (!this.file) return null;
    let content: string;
    try {
      content = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return 'Settings file is unreadable; defaults are used.';
    }
    try {
      this.apply(await validateSettings(JSON.parse(content)));
      return null;
    } catch {
      return 'Settings file is invalid; defaults are used.';
    }
  }

  save(input: unknown): Promise<Settings> {
    const next = this.writing.then(async () => {
      const settings = await validateSettings(input);
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
            mode: 0o600,
          });
          await rename(temporary, this.file);
        } catch (error) {
          await rm(temporary, { force: true });
          throw error;
        }
      }
      this.apply(settings);
      return settings;
    });
    this.writing = next.catch(() => undefined);
    return next;
  }

  describe(): Omit<SettingsResponse, 'rescan'> {
    return {
      settings: this.current,
      effectiveScanPaths: [...this.scanPaths],
      scanPathsSource: this.current.scanPaths === null ? 'env' : 'settings',
    };
  }

  private apply(settings: Settings) {
    this.current = settings;
    this.scanPaths.splice(
      0,
      this.scanPaths.length,
      ...(settings.scanPaths ?? this.envScanPaths),
    );
  }
}
