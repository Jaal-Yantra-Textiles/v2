import { z } from "@medusajs/framework/zod";

const querySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  status: z.string().optional()
});


export type ListInventoryOrdersQuery = z.infer<typeof querySchema>;