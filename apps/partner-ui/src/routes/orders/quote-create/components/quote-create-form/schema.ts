import { z } from "@medusajs/framework/zod"

/**
 * Mirrors `apps/backend/src/api/partners/quotes/validators.ts`.
 *
 * 🔑 There is no `customer_id` here, deliberately — the mint find-or-creates
 * the buyer BY EMAIL, scoped to the store (`mint-quote.ts`). Picking an
 * existing customer and typing their address are the same request. The picker
 * exists so a typo cannot silently create a second customer.
 */
export const QuoteBuyerSchema = z.object({
  buyer_email: z.string().email(),
  recipient_name: z.string().optional(),
  recipient_company: z.string().optional(),
  partner_note: z.string().optional(),

  destination_country_code: z.string().min(2),
  destination_postal_code: z.string().optional(),
  destination_city: z.string().optional(),

  currency_code: z.string().min(3),
  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),
})

export const QuoteProductsSchema = z.object({
  product_ids: z.array(z.object({ id: z.string() })),
})

/**
 * Quantity per variant, keyed by variant id. A blank or zero quantity is NOT a
 * zero-priced line — it means "not in this basket", and is dropped before the
 * request is built. The backend applies the same rule one level down: a line
 * whose amount cannot be resolved is dropped, never zeroed, because a zero
 * would mint an ACTIVE price of zero that the cart would honour.
 */
export const QuoteQuantitiesSchema = z.object({
  quantities: z.record(z.string(), z.number().nullish()),
})

export const QuoteCreateSchema = QuoteBuyerSchema.merge(
  QuoteProductsSchema
).merge(QuoteQuantitiesSchema)

export type QuoteCreateSchemaType = z.infer<typeof QuoteCreateSchema>

export const QuoteBuyerFields = [
  "buyer_email",
  "recipient_name",
  "recipient_company",
  "partner_note",
  "destination_country_code",
  "destination_postal_code",
  "destination_city",
  "currency_code",
  "ttl_days",
] as const

export const QuoteProductFields = ["product_ids"] as const
export const QuoteQuantityFields = ["quantities"] as const
