import { z } from "@medusajs/framework/zod"

// "Abandoned" filter tiers — explained on the list route.
// - all          : every cart not yet completed (includes empty browse-carts)
// - has_items    : has at least one line item
// - recoverable  : has items AND email or customer_id (we can reach them)
// - checkout     : recoverable AND has shipping_address (highest intent)
const TIER_VALUES = ["all", "has_items", "recoverable", "checkout"] as const

export const listAbandonedCartsQuerySchema = z.object({
  tier: z.enum(TIER_VALUES).optional().default("has_items"),
  // Idle threshold in minutes. Cart is considered abandoned once
  // updated_at < now() - idle_minutes. Default 60.
  idle_minutes: z.preprocess(
    (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined),
    z.number().int().min(0).max(60 * 24 * 90).default(60),
  ),
  q: z.string().optional(),
  sales_channel_id: z.string().optional(),
  region_id: z.string().optional(),
  customer_id: z.string().optional(),
  email: z.string().optional(),
  offset: z.preprocess(
    (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined),
    z.number().int().min(0).default(0),
  ),
  limit: z.preprocess(
    (val) => (val !== undefined && val !== null && val !== "" ? Number(val) : undefined),
    z.number().int().min(1).max(100).default(20),
  ),
  // Sort key: updated_at | created_at. Default updated_at desc.
  order: z.string().optional(),
})

export type ListAbandonedCartsQuery = z.infer<typeof listAbandonedCartsQuerySchema>

export const retrieveAbandonedCartQuerySchema = z.object({
  fields: z.string().optional(),
})
