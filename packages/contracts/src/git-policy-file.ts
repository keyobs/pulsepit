import { z } from 'zod';
import { GitBranchPolicy } from './git-policy.js';

// Portable declaration only; runner definitions stay outside this document.
export const GitPolicyFile = z.strictObject({
  version: z.literal(1),
  remote: z.literal('origin'),
  default: GitBranchPolicy.strict().default({
    directPush: 'unknown',
    requiredChecks: null,
  }),
  branches: z.record(z.string().min(1), GitBranchPolicy.strict()).default({}),
});
export type GitPolicyFile = z.infer<typeof GitPolicyFile>;
