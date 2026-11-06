import type { Settings } from '@api/types';

/** `branch` : verrou propre à cette branche du dépôt ; `other` : verrou plus large, non modifiable ici. */
export type PushLockScope = 'none' | 'branch' | 'other';

export function pushLockScope(
  settings: Settings,
  path: string,
  branch: string,
): PushLockScope {
  const { all, branches, repositories } = settings.pushLocks;
  const repository = Object.hasOwn(repositories, path)
    ? repositories[path]
    : undefined;
  if (all || branches.includes(branch) || repository?.all) return 'other';
  return repository?.branches.includes(branch) ? 'branch' : 'none';
}

export function toggleBranchLock(
  settings: Settings,
  path: string,
  branch: string,
): Settings {
  const repositories = { ...settings.pushLocks.repositories };
  const current = repositories[path]?.branches ?? [];
  const branches = current.includes(branch)
    ? current.filter((name) => name !== branch)
    : [...current, branch];
  if (branches.length) repositories[path] = { all: false, branches };
  else delete repositories[path];
  return { ...settings, pushLocks: { ...settings.pushLocks, repositories } };
}
