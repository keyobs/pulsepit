import { z } from 'zod';

export const DeploymentHosting = z.object({
  label: z.string().min(1),
  url: z.url().nullable(),
});
export type DeploymentHosting = z.infer<typeof DeploymentHosting>;

export const DeploymentEnvironmentConfig = z.object({
  environment: z.string().min(1),
  label: z.string().min(1),
  branch: z.string().min(1).nullable(),
  url: z.url().nullable(),
  hosting: DeploymentHosting.nullable(),
});
export type DeploymentEnvironmentConfig = z.infer<
  typeof DeploymentEnvironmentConfig
>;

export const DeploymentMetadataError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type DeploymentMetadataError = z.infer<typeof DeploymentMetadataError>;

export const DeploymentCommitComparison = z.discriminatedUnion('status', [
  z.object({
    reference: z.string().nullable(),
    referenceCommit: z.string().nullable(),
    status: z.literal('unknown'),
    ahead: z.null(),
    behind: z.null(),
    reason: z.enum([
      'BRANCH_NOT_CONFIGURED',
      'INVALID_BRANCH',
      'COMMIT_UNAVAILABLE',
      'BRANCH_NOT_FOUND',
      'COMMIT_NOT_FOUND',
      'SHALLOW_HISTORY',
      'UNRELATED_HISTORY',
      'TIMEOUT',
      'GIT_ERROR',
    ]),
  }),
  z
    .object({
      reference: z.string().min(1),
      referenceCommit: z.string().min(1),
      status: z.enum(['up_to_date', 'behind', 'ahead', 'diverged']),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
      reason: z.null(),
    })
    .refine((value) => {
      if (value.status === 'up_to_date')
        return value.ahead === 0 && value.behind === 0;
      if (value.status === 'behind')
        return value.ahead === 0 && value.behind > 0;
      if (value.status === 'ahead')
        return value.ahead > 0 && value.behind === 0;
      return value.ahead > 0 && value.behind > 0;
    }, 'The comparison status must match its commit counts.'),
]);
export type DeploymentCommitComparison = z.infer<
  typeof DeploymentCommitComparison
>;

export const DeploymentEnvironment = DeploymentEnvironmentConfig.extend({
  version: z.string().nullable(),
  commit: z.string().nullable(),
  deployedAt: z.iso.datetime().nullable(),
  deploymentSource: z.enum(['delivery', 'provider']).nullable(),
  metadataCheckedAt: z.iso.datetime().nullable(),
  metadataError: DeploymentMetadataError.nullable(),
  comparison: DeploymentCommitComparison,
});
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironment>;

export const DeploymentsResponse = z.object({
  path: z.string(),
  environments: z.array(DeploymentEnvironment),
});
export type DeploymentsResponse = z.infer<typeof DeploymentsResponse>;
