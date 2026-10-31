import { z } from 'zod';

export const RescanInterval = z.enum(['15m', '30m', '1h', '6h']);
export type RescanInterval = z.infer<typeof RescanInterval>;

const LockedBranches = z.array(z.string().min(1)).max(256);

export const RepositoryPushLock = z
  .object({ all: z.boolean(), branches: LockedBranches })
  .strict();
export type RepositoryPushLock = z.infer<typeof RepositoryPushLock>;

export const PushLocks = z
  .object({
    all: z.boolean(),
    branches: LockedBranches,
    repositories: z.record(z.string().min(1), RepositoryPushLock),
  })
  .strict();
export type PushLocks = z.infer<typeof PushLocks>;

export const Settings = z
  .object({
    scanPaths: z.array(z.string().min(1)).min(1).max(32).nullable(),
    rescan: z
      .object({ enabled: z.boolean(), interval: RescanInterval })
      .strict(),
    pushLocks: PushLocks,
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

export const RescanFailure = z.object({
  path: z.string(),
  code: z.enum(['FETCH_FAILED', 'TIMEOUT']),
});
export type RescanFailure = z.infer<typeof RescanFailure>;

export const RescanState = z.object({
  lastStartedAt: z.iso.datetime().nullable(),
  lastFinishedAt: z.iso.datetime().nullable(),
  failures: z.array(RescanFailure),
});
export type RescanState = z.infer<typeof RescanState>;

export const SettingsResponse = z.object({
  settings: Settings,
  effectiveScanPaths: z.array(z.string()),
  scanPathsSource: z.enum(['settings', 'env']),
  rescan: RescanState,
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;
