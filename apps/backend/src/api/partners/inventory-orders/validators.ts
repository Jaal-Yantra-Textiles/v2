import { z } from "@medusajs/framework/zod";

// NOTE: this schema is NOT what validates the route. The
// `/partners/inventory-orders` matcher validates with the ADMIN
// `listInventoryOrdersQuerySchema` (see src/api/middlewares.ts), which is
// stricter — `status` there is the real status enum. This one only supplies the
// handler's type, so do not treat it as the query contract (#843).
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