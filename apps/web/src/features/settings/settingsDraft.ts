import type { Settings } from '@api/types';

export interface RepositoryLockDraft {
  path: string;
  all: boolean;
  branches: string;
}

/** Réglages en cours d'édition : les branches restent du texte libre jusqu'à l'enregistrement. */
export interface SettingsDraft {
  scanPaths: string[];
  rescan: Settings['rescan'];
  lockAll: boolean;
  lockedBranches: string;
  repositories: RepositoryLockDraft[];
}

const joinBranches = (branches: string[]) => branches.join(', ');

export const splitBranches = (text: string) => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((branch) => branch.trim())
      .filter(Boolean),
  ),
];

export function toDraft(settings: Settings): SettingsDraft {
  return {
    scanPaths: settings.scanPaths ?? [],
    rescan: settings.rescan,
    lockAll: settings.pushLocks.all,
    lockedBranches: joinBranches(settings.pushLocks.branches),
    repositories: Object.entries(settings.pushLocks.repositories).map(
      ([path, lock]) => ({
        path,
        all: lock.all,
        branches: joinBranches(lock.branches),
      }),
    ),
  };
}

export function fromDraft(draft: SettingsDraft): Settings {
  return {
    scanPaths: draft.scanPaths.length ? draft.scanPaths : null,
    rescan: draft.rescan,
    pushLocks: {
      all: draft.lockAll,
      branches: splitBranches(draft.lockedBranches),
      repositories: Object.fromEntries(
        draft.repositories.map(({ path, all, branches }) => [
          path,
          { all, branches: splitBranches(branches) },
        ]),
      ),
    },
  };
}
