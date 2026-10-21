import { z } from 'zod';

export const MonitoringRequest = z.object({
  path: z.string().min(1),
  environment: z.string().min(1).optional(),
});

export type MonitoringRequest = z.infer<typeof MonitoringRequest>;

export const DeploymentCheck = z.object({
  environment: z.string(),
  url: z.string(),
  status: z.enum(['online', 'offline']),
  statusCode: z.number().int().nullable(),
  responseTimeMs: z.number().int().nonnegative(),
  checkedAt: z.string(),
  errorCode: z.enum(['HTTP_ERROR', 'TIMEOUT', 'NETWORK_ERROR']).nullable(),
  error: z.string().nullable(),
});

export type DeploymentCheck = z.infer<typeof DeploymentCheck>;

export const MonitoringResponse = z.object({
  path: z.string(),
  configured: z.boolean(),
  checks: z.array(DeploymentCheck),
});

export type MonitoringResponse = z.infer<typeof MonitoringResponse>;
