import { z } from 'zod';
import { GitCheckId, PushPolicyCode } from './git-policy.js';

export const CheckStatus = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'cancelled',
  'timed_out',
]);
export type CheckStatus = z.infer<typeof CheckStatus>;
export const CheckExecution = z
  .object({
    checkId: GitCheckId,
    required: z.boolean(),
    status: CheckStatus,
    commit: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .nullable(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
  })
  .superRefine((check, ctx) => {
    const terminal = !['pending', 'running'].includes(check.status);
    if (
      ['passed', 'failed'].includes(check.status) &&
      (check.commit === null || check.startedAt === null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'A completed check needs a commit and start time.',
      });
    if (
      terminal !== (check.completedAt !== null) ||
      (check.status === 'pending' && check.startedAt !== null) ||
      (check.status === 'running' && check.startedAt === null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent check timestamps.',
      });
  });
export type CheckExecution = z.infer<typeof CheckExecution>;
export const ChecksOperation = z
  .object({
    id: z.uuid(),
    path: z.string(),
    branch: z.string(),
    commit: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
      .nullable(),
    status: z.enum([
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'timed_out',
    ]),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    checks: z.array(CheckExecution).min(1),
    error: z
      .object({
        code: z.enum([
          ...PushPolicyCode.options,
          'CHECKS_TIMEOUT',
          'CHECKS_CANCELLED',
          'CHECKS_FAILED',
        ]),
        message: z.string().min(1),
      })
      .nullable(),
  })
  .superRefine((operation, ctx) => {
    const terminal = !['queued', 'running'].includes(operation.status);
    if (
      terminal !== (operation.completedAt !== null) ||
      (operation.status === 'queued' && operation.startedAt !== null) ||
      (operation.status === 'running' && operation.startedAt === null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent operation timestamps.',
      });
    if (
      (!terminal && operation.error !== null) ||
      (terminal &&
        operation.status !== 'succeeded' &&
        operation.error === null) ||
      new Set(operation.checks.map((check) => check.checkId)).size !==
        operation.checks.length ||
      operation.checks.some((check) => check.commit !== operation.commit)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent operation result.',
      });
    if (
      operation.status === 'succeeded' &&
      (operation.commit === null ||
        operation.startedAt === null ||
        operation.error !== null ||
        operation.checks.some(
          (check) => check.required && check.status !== 'passed',
        ))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Required checks must pass before operation success.',
      });
  });
export type ChecksOperation = z.infer<typeof ChecksOperation>;
