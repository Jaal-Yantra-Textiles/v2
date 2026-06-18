import { z } from "@medusajs/framework/zod";

const querySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  status: z.string().optional(),
  // Free-text search forwarded by the partner UI (DataTableSearch -> ?q=).
  // Validated by the shared admin listInventoryOrdersQuerySchema middleware;
  // declared here so the route can read it type-safely.
  q: z.string().optional()
});


export type ListInventoryOrdersQuery = z.infer<typeof querySchema>;