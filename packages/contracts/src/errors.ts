import { z } from 'zod';

export const ErrorResponse = z.object({
  error: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
