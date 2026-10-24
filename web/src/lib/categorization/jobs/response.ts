import { z } from 'zod';
import { categorizationJobSchema } from './schema';

/** Browser-safe response contract; configuration availability is not proof a worker ran. */
export const categorizationJobsResponseSchema = z.object({
  job: categorizationJobSchema.nullable(),
  backgroundAvailable: z.boolean(),
  issue: z.string().max(600).nullable(),
}).strict();
export type CategorizationJobsResponse = z.infer<typeof categorizationJobsResponseSchema>;
