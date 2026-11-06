import { z } from 'zod';

export const InstallRequest = z.object({ path: z.string().min(1) });

export type InstallRequest = z.infer<typeof InstallRequest>;

export const InstallResponse = z.object({
  path: z.string(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn']),
  command: z.string(),
  durationMs: z.number().int().nonnegative(),
  success: z.literal(true),
});

export type InstallResponse = z.infer<typeof InstallResponse>;
