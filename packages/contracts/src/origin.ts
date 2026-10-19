import { z } from 'zod';

export const OriginRemote = z.object({
  name: z.literal('origin'),
  url: z.string().nullable(),
  github: z
    .object({
      owner: z.string(),
      repo: z.string(),
      url: z.string(),
    })
    .nullable(),
});

export type OriginRemote = z.infer<typeof OriginRemote>;

export const OriginResponse = z.object({
  path: z.string(),
  origin: OriginRemote.nullable(),
  originError: z.string().nullable(),
});

export type OriginResponse = z.infer<typeof OriginResponse>;
