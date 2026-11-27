import { z } from "zod"

/**
 * Query for the storefront delivery check. Only shape is checked here; the
 * per-country postal format is checked in the route (`normalizePostalCode`),
 * so a bad pin gets a friendly 200 answer the box can show, not a 400.
 */
export const StoreDeliveryCheckSchema = z.object({
  country_code: z.string().trim().length(2),
  postal_code: z.string().trim().max(16).optional().default(""),
  variant_id: z.string().min(1).max(64).optional(),
  cart_id: z.string().min(1).max(64).optional(),
})

export type StoreDeliveryCheckReq = z.infer<typeof StoreDeliveryCheckSchema>
