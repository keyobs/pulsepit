import { z } from 'zod';

export const LocalBranch = z.object({
  name: z.string(),
  isCurrent: z.boolean(),
});

export type LocalBranch = z.infer<typeof LocalBranch>;

export const BranchesResponse = z.object({
  path: z.string(),
  branches: z.array(LocalBranch),
});

export type BranchesResponse = z.infer<typeof BranchesResponse>;
