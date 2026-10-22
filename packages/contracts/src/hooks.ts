import { z } from 'zod';

export const GitHookFile = z.object({
  path: z.string().min(1).nullable(),
  state: z.enum([
    'missing',
    'executable',
    'not_executable',
    'unreadable',
    'unsupported',
  ]),
});
export type GitHookFile = z.infer<typeof GitHookFile>;

export const GitHook = z.object({
  name: z.enum(['pre-commit', 'commit-msg', 'pre-push']),
  file: GitHookFile,
  husky: z.object({ loader: GitHookFile, script: GitHookFile }).nullable(),
});
export type GitHook = z.infer<typeof GitHook>;

export const RepositoryHooksResponse = z
  .object({
    path: z.string().min(1),
    directory: z.string().min(1).nullable(),
    source: z.enum(['default', 'configured']).nullable(),
    directoryState: z
      .enum([
        'directory',
        'missing',
        'not_directory',
        'unreadable',
        'unsupported',
      ])
      .nullable(),
    hooks: z.tuple([
      GitHook.extend({ name: z.literal('pre-commit') }),
      GitHook.extend({ name: z.literal('commit-msg') }),
      GitHook.extend({ name: z.literal('pre-push') }),
    ]),
    error: z
      .object({
        code: z.enum(['HOOKS_READ_FAILED', 'TIMEOUT']),
        message: z.string().min(1),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    if (value.error !== null) {
      if (
        value.directory !== null ||
        value.source !== null ||
        value.directoryState !== null ||
        value.hooks.some(
          (hook) =>
            hook.file.path !== null ||
            hook.file.state !== 'unsupported' ||
            hook.husky !== null,
        )
      )
        context.addIssue({
          code: 'custom',
          message:
            'A Git read failure must leave hook locations and availability unknown.',
        });
    } else if (
      value.directory === null ||
      value.source === null ||
      value.directoryState === null ||
      value.hooks.some(
        (hook) =>
          hook.file.path === null ||
          (hook.husky !== null &&
            (hook.husky.loader.path === null ||
              hook.husky.script.path === null)),
      )
    )
      context.addIssue({
        code: 'custom',
        message:
          'A completed hook inspection must identify its file locations.',
      });
  });
export type RepositoryHooksResponse = z.infer<typeof RepositoryHooksResponse>;
