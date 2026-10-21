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

export const DeploymentEnvironment = DeploymentEnvironmentConfig.extend({
  deployedAt: z.iso.datetime().nullable(),
  deploymentSource: z.enum(['delivery', 'provider']).nullable(),
  metadataCheckedAt: z.iso.datetime().nullable(),
  metadataError: DeploymentMetadataError.nullable(),
});
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironment>;

export const DeploymentsResponse = z.object({
  path: z.string(),
  environments: z.array(DeploymentEnvironment),
});
export type DeploymentsResponse = z.infer<typeof DeploymentsResponse>;
