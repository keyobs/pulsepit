import { z } from 'zod';
import { DeploymentMetadataError } from './deployments.js';

export const BeaconMonitoringInterval = z.enum(['5m', '15m', '30m', '1h']);
export type BeaconMonitoringInterval = z.infer<typeof BeaconMonitoringInterval>;

export const BeaconMonitoringEnvironment = z.object({
  path: z.string(),
  environment: z.string(),
  enabled: z.boolean(),
  interval: BeaconMonitoringInterval.nullable(),
  status: z.enum(['pending', 'up', 'down', 'disabled']),
  since: z.iso.datetime().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  error: DeploymentMetadataError.nullable(),
});
export type BeaconMonitoringEnvironment = z.infer<
  typeof BeaconMonitoringEnvironment
>;

export const BeaconMonitoringResponse = z.object({
  environments: z.array(BeaconMonitoringEnvironment),
});
export type BeaconMonitoringResponse = z.infer<typeof BeaconMonitoringResponse>;
