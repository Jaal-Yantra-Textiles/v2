import { z } from "@medusajs/framework/zod"

/**
 * A price row inside a price list. `min_quantity`/`max_quantity` are what make
 * a quote's tier ladder real — core matches a price when
 * `min_quantity <= qty AND max_quantity >= qty`.
 */
const PriceListPrice = z.object({
  variant_id: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  min_quantity: z.number().int().nonnegative().nullish(),
  max_quantity: z.number().int().nonnegative().nullish(),
  rules: z.record(z.string(), z.string()).optional(),
})

/**
 * 🔴 `rules` is the field that decides WHO a price list applies to, and a list
 * created with no rules at all has `rules_count = 0` — which core happily
 * matches for every customer on the platform. It stays optional because core
 * allows it, but the route asserts ownership of any `customer_group_id` named
 * here: owning the list says nothing about owning the group you scope it to.
 */
const PriceListRules = z.record(z.string(), z.array(z.string()))

export const PartnerCreatePriceListReq = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  starts_at: z.string().nullish(),
  ends_at: z.string().nullish(),
  status: z.enum(["active", "draft"]).optional(),
  type: z.enum(["sale", "override"]).optional(),
  rules: PriceListRules.optional(),
  prices: z.array(PriceListPrice).optional(),
})

export const PartnerUpdatePriceListReq = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).nullish(),
  starts_at: z.string().nullish(),
  ends_at: z.string().nullish(),
  status: z.enum(["active", "draft"]).optional(),
  rules: PriceListRules.optional(),
})
