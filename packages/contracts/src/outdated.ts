import { z } from 'zod';

export const RegistryDiagnosticCode = z.enum([
  'REGISTRY_CREDENTIALS_MISSING',
  'REGISTRY_AUTHENTICATION_FAILED',
  'REGISTRY_ACCESS_DENIED',
  'REGISTRY_DNS_FAILED',
  'REGISTRY_CONNECTION_FAILED',
  'REGISTRY_TLS_FAILED',
  'REGISTRY_REQUEST_TIMEOUT',
  'REGISTRY_UNAVAILABLE',
  'REGISTRY_RATE_LIMITED',
]);
export type RegistryDiagnosticCode = z.infer<typeof RegistryDiagnosticCode>;

export const OutdatedRequest = z.object({ path: z.string().min(1) });

export type OutdatedRequest = z.infer<typeof OutdatedRequest>;

export const OutdatedDependency = z.object({
  name: z.string(),
  current: z.string().nullable(),
  wanted: z.string(),
  latest: z.string(),
  dependent: z.string().nullable(),
  location: z.string().nullable(),
});

export type OutdatedDependency = z.infer<typeof OutdatedDependency>;

export const OutdatedResponse = z.object({
  path: z.string(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn']),
  dependencies: z.array(OutdatedDependency),
  error: z.null(),
});

export type OutdatedResponse = z.infer<typeof OutdatedResponse>;
