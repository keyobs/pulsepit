import { z } from 'zod';

export const GithubActionsRun = z.object({
  id: z.number().int().positive(),
  workflowId: z.number().int().positive(),
  name: z.string().nullable(),
  title: z.string(),
  url: z.url(),
  branch: z.string().nullable(),
  headSha: z.string(),
  event: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type GithubActionsRun = z.infer<typeof GithubActionsRun>;

export const GithubActionsRunsResponse = z.object({
  path: z.string(),
  repository: z.object({ owner: z.string(), repo: z.string(), url: z.url() }),
  branch: z.string().nullable(),
  limit: z.number().int().min(1).max(30),
  checkedAt: z.iso.datetime(),
  runs: z.array(GithubActionsRun),
  rateLimit: z
    .object({
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    })
    .nullable(),
});
export type GithubActionsRunsResponse = z.infer<
  typeof GithubActionsRunsResponse
>;
