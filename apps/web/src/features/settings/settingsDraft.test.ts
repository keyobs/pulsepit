import type { Settings } from '@api/types';
import { fromDraft, splitBranches, toDraft } from './settingsDraft';

const settings: Settings = {
  scanPaths: ['/home/user/Projets'],
  rescan: { enabled: true, interval: '1h' },
  pushLocks: {
    all: false,
    branches: ['main', 'develop'],
    repositories: {
      '/home/user/Projets/app': { all: false, branches: ['release'] },
    },
  },
};

describe('settingsDraft', () => {
  it('round-trips settings through the editable draft', () => {
    const draft = toDraft(settings);
    expect(draft.lockedBranches).toBe('main, develop');
    expect(fromDraft(draft)).toEqual(settings);
  });

  it('splits free text branches and drops duplicates', () => {
    expect(splitBranches(' main,, develop main\nfeat/x ')).toEqual([
      'main',
      'develop',
      'feat/x',
    ]);
  });

  it('falls back to SCAN_PATH when no folder is listed', () => {
    const draft = { ...toDraft(settings), scanPaths: [] };
    expect(fromDraft(draft).scanPaths).toBeNull();
  });
});
