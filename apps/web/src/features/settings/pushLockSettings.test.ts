import type { Settings } from '@api/types';
import { pushLockScope, toggleBranchLock } from './pushLockSettings';

const PATH = '/home/user/Projets/app';
const base: Settings = {
  scanPaths: null,
  rescan: { enabled: false, interval: '1h' },
  pushLocks: { all: false, branches: [], repositories: {} },
};

describe('pushLockSettings', () => {
  it('adds then removes a repository branch lock', () => {
    const locked = toggleBranchLock(base, PATH, 'main');
    expect(locked.pushLocks.repositories).toEqual({
      [PATH]: { all: false, branches: ['main'] },
    });
    expect(pushLockScope(locked, PATH, 'main')).toBe('branch');
    expect(pushLockScope(locked, PATH, 'develop')).toBe('none');

    const unlocked = toggleBranchLock(locked, PATH, 'main');
    expect(unlocked.pushLocks.repositories).toEqual({});
  });

  it('reports wider locks as not editable from the branch', () => {
    const global = { ...base, pushLocks: { ...base.pushLocks, all: true } };
    const shared = {
      ...base,
      pushLocks: { ...base.pushLocks, branches: ['main'] },
    };
    const repository = {
      ...base,
      pushLocks: {
        ...base.pushLocks,
        repositories: { [PATH]: { all: true, branches: [] } },
      },
    };
    for (const settings of [global, shared, repository])
      expect(pushLockScope(settings, PATH, 'main')).toBe('other');
  });
});
