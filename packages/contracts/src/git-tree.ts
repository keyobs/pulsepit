import { z } from 'zod';

export const GitCommitSummary = z.object({
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
});

export type GitCommitSummary = z.infer<typeof GitCommitSummary>;

export const GitBranchSummary = z.object({
  name: z.string(),
  author: z.string(),
  createdAt: z.string(),
  merged: z.boolean(),
});

export type GitBranchSummary = z.infer<typeof GitBranchSummary>;

export const GitTreeResponse = z.object({
  path: z.string(),
  mainRef: z.string().nullable(),
  commits: z.array(GitCommitSummary),
  branches: z.array(GitBranchSummary),
});

export type GitTreeResponse = z.infer<typeof GitTreeResponse>;
