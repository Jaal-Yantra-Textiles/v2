import { z } from "@medusajs/framework/zod";

// Query schema for listing persons publicly
export const listPublicPersonsQuerySchema = z.object({
  q: z.string().optional(),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(0).default(0)
  ),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20)
  ),
  order: z.string().optional(),
}).passthrough();

export type ListPublicPersonsQuery = z.infer<typeof listPublicPersonsQuerySchema>;
