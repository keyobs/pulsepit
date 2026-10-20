import { z } from 'zod';

export const FetchRequest = z.object({ path: z.string().min(1) });

export type FetchRequest = z.infer<typeof FetchRequest>;

export const FetchResponse = z.object({
  path: z.string(),
  success: z.literal(true),
});

export type FetchResponse = z.infer<typeof FetchResponse>;

export const PushRequest = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
});

export type PushRequest = z.infer<typeof PushRequest>;

export const PushResponse = z.object({
  path: z.string(),
  branch: z.string(),
  remote: z.literal('origin'),
  success: z.literal(true),
});

export type PushResponse = z.infer<typeof PushResponse>;
