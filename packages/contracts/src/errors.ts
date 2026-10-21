import { z } from 'zod';

export const ErrorResponse = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
  resetAt: z.iso.datetime().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
