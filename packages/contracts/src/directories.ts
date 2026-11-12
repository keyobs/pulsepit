import { z } from 'zod';

export const DirectoryEntry = z.object({
  name: z.string(),
  path: z.string(),
  isGitRepo: z.boolean(),
});

export type DirectoryEntry = z.infer<typeof DirectoryEntry>;

export const DirectoryListResponse = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  directories: z.array(DirectoryEntry),
  truncated: z.boolean(),
});

export type DirectoryListResponse = z.infer<typeof DirectoryListResponse>;
