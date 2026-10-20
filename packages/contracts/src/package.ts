import { z } from 'zod';

export const PackageResponse = z.object({
  path: z.string(),
  ref: z.enum(['head', 'main', 'develop']),
  manifest: z.record(z.string(), z.unknown()),
});
export type PackageResponse = z.infer<typeof PackageResponse>;
