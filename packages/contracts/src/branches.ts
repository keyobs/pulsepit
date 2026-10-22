import { z } from 'zod';
import { GitBranchPolicy, PushAssessment } from './git-policy.js';

export const LocalBranch = z.object({
  name: z.string(),
  isCurrent: z.boolean(),
  policy: GitBranchPolicy,
  pushAssessment: PushAssessment,
});

export type LocalBranch = z.infer<typeof LocalBranch>;

export const BranchesResponse = z.object({
  path: z.string(),
  branches: z.array(LocalBranch),
});

export type BranchesResponse = z.infer<typeof BranchesResponse>;
