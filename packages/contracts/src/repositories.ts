import { z } from 'zod';
import { DeploymentEnvironmentConfig } from './deployments.js';
import { OriginRemote } from './origin.js';

export const GitStatus = z.object({
  branch: z.string().nullable(),
  isClean: z.boolean(),
  changedFiles: z.number().int().nonnegative(),
  untrackedFiles: z.number().int().nonnegative(),
});

export type GitStatus = z.infer<typeof GitStatus>;

export const PackageVersion = z.object({
  version: z.string().nullable(),
  error: z.string().nullable(),
});

export type PackageVersion = z.infer<typeof PackageVersion>;

export const PackageVersions = z.object({
  head: PackageVersion,
  main: PackageVersion,
  develop: PackageVersion,
});

export type PackageVersions = z.infer<typeof PackageVersions>;

export const PackageManagerDetection = z.object({
  name: z.enum(['npm', 'pnpm', 'yarn']).nullable(),
  source: z.enum(['packageManager', 'lockfile']).nullable(),
  error: z.string().nullable(),
});

export type PackageManagerDetection = z.infer<typeof PackageManagerDetection>;

export const RepositorySync = z.object({
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
});

export type RepositorySync = z.infer<typeof RepositorySync>;

export const RepositoryBeacon = z.object({
  package: z.boolean(),
  configuration: z.enum(['missing', 'partial', 'ok', 'invalid']),
  active: z.boolean(),
});
export type RepositoryBeacon = z.infer<typeof RepositoryBeacon>;

export const Repository = z.object({
  name: z.string(),
  path: z.string(),
  git: GitStatus.nullable(),
  gitError: z.string().nullable(),
  sync: RepositorySync.nullable(),
  developLastCommitAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  versions: PackageVersions,
  engines: z.record(z.string(), z.string()).nullable(),
  enginesError: z.string().nullable(),
  packageManager: PackageManagerDetection,
  origin: OriginRemote.nullable(),
  originError: z.string().nullable(),
  urls: z.record(z.string(), z.string()),
  hosting: z.record(z.string(), z.string()),
  deploymentEnvironments: z.array(DeploymentEnvironmentConfig),
  beacon: RepositoryBeacon,
});

export type Repository = z.infer<typeof Repository>;

export const ScanError = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export type ScanError = z.infer<typeof ScanError>;

export const ListRepositoriesResponse = z.object({
  scanPaths: z.array(z.string()),
  repositories: z.array(Repository),
  scanErrors: z.array(ScanError),
});

export type ListRepositoriesResponse = z.infer<typeof ListRepositoriesResponse>;
