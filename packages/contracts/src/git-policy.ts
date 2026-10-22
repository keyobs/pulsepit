import { z } from 'zod';

export const PushPolicyCode = z.enum([
  'DIRECT_PUSH_FORBIDDEN',
  'INVALID_PUSH_POLICY',
  'CHECK_RUNNER_UNAVAILABLE',
  'CHECK_CONTEXT_MISMATCH',
  'CHECK_FAILED',
  'POLICY_UNCONFIGURED',
  'POLICY_INCOMPLETE',
  'GIT_STATE_UNAVAILABLE',
]);
export type PushPolicyCode = z.infer<typeof PushPolicyCode>;

export const GitCheckId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type GitCheckId = z.infer<typeof GitCheckId>;
const RequiredChecks = z
  .array(GitCheckId)
  .max(64)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Check identifiers must be unique.',
  );
export const GitBranchPolicy = z.object({
  directPush: z.enum(['allowed', 'forbidden', 'unknown']),
  requiredChecks: RequiredChecks.nullable(),
});
export type GitBranchPolicy = z.infer<typeof GitBranchPolicy>;
const UnknownBranchPolicy = z.object({
  directPush: z.literal('unknown'),
  requiredChecks: z.null(),
});
const NoBranchPolicies = z
  .record(z.string(), GitBranchPolicy)
  .refine(
    (value) => Object.keys(value).length === 0,
    'No branch policies are available in this state.',
  );
export const RepositoryGitPolicy = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('configured'),
    source: z.literal('local-config'),
    remote: z.literal('origin'),
    default: GitBranchPolicy,
    branches: z.record(z.string().min(1), GitBranchPolicy),
    error: z.null(),
  }),
  z.object({
    state: z.literal('unconfigured'),
    source: z.null(),
    remote: z.literal('origin'),
    default: UnknownBranchPolicy,
    branches: NoBranchPolicies,
    error: z.null(),
  }),
  z.object({
    state: z.literal('invalid'),
    source: z.null(),
    remote: z.literal('origin'),
    default: UnknownBranchPolicy,
    branches: NoBranchPolicies,
    error: z.object({
      code: z.literal('INVALID_PUSH_POLICY'),
      message: z.string().min(1),
    }),
  }),
]);
export type RepositoryGitPolicy = z.infer<typeof RepositoryGitPolicy>;
export const PushPolicyReason = z.object({
  code: PushPolicyCode,
  message: z.string().min(1),
});
export type PushPolicyReason = z.infer<typeof PushPolicyReason>;
const informational = (code: PushPolicyCode) =>
  code === 'POLICY_UNCONFIGURED' || code === 'POLICY_INCOMPLETE';
export const PushAssessment = z
  .discriminatedUnion('state', [
    z.object({
      state: z.literal('ready'),
      canAttempt: z.literal(true),
      reasons: z.array(PushPolicyReason).max(0),
    }),
    z.object({
      state: z.literal('blocked'),
      canAttempt: z.literal(false),
      reasons: z.array(PushPolicyReason).min(1),
    }),
    z.object({
      state: z.literal('unknown'),
      canAttempt: z.boolean(),
      reasons: z.array(PushPolicyReason).min(1),
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.canAttempt &&
      value.reasons.some((reason) => !informational(reason.code))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'An actionable assessment cannot contain blocking reasons.',
      });
    }
    if (
      !value.canAttempt &&
      value.reasons.every((reason) => informational(reason.code))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'A denied attempt requires a blocking reason.',
      });
    }
  });
export type PushAssessment = z.infer<typeof PushAssessment>;
