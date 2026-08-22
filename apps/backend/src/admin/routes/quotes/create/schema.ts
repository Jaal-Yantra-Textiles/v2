import { z } from "@medusajs/framework/zod"

/**
 * Mirrors `apps/backend/src/api/admin/quotes/validators.ts`, which is itself
 * the partner mint schema plus `partner_id`.
 *
 * 🔑 No `customer_id`. The mint find-or-creates the buyer BY EMAIL scoped to
 * the partner's store, so an id would be discarded — the picker exists so a
 * typo cannot silently create a second customer, not to pass a reference.
 */
export const QuotePartnerSchema = z.object({
  partner_id: z.string().min(1),
})

export const QuoteBuyerSchema = z.object({
  buyer_email: z.string().email(),
  recipient_name: z.string().optional(),
  recipient_company: z.string().optional(),
  partner_note: z.string().optional(),

  /**
   * The region is the wizard's own field — the mint takes `region_id`,
   * `currency_code` and `destination_country_code` separately, and this is
   * what keeps the three consistent. Picking a region sets the currency and
   * narrows the countries to the ones it covers, so "INR to a GB address" —
   * which no region supports and the preflight refused after the fact — stops
   * being expressible.
   */
  region_id: z.string().min(1),
  currency_code: z.string().min(3),
  destination_country_code: z.string().min(2),
  destination_postal_code: z.string().optional(),
  destination_city: z.string().optional(),

  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),
})

export const QuoteProductsSchema = z.object({
  product_ids: z.array(z.object({ id: z.string() })),
})

/**
 * Quantity per variant, keyed by variant id, plus the trade price (#1446).
 *
 * A blank or zero quantity is NOT a zero-priced line — it means "not in this
 * basket" and is dropped before the request is built. Same for a blank
 * override: sent as 0 it would ask the backend to mint an ACTIVE price of
 * zero, which it refuses.
 */
export const QuoteQuantitiesSchema = z.object({
  quantities: z.record(z.string(), z.number().nullish()),
  discounts: z.record(z.string(), z.number().nullish()),
  overrides: z.record(z.string(), z.number().nullish()),
})

export const AdminQuoteCreateSchema = QuotePartnerSchema.merge(QuoteBuyerSchema)
  .merge(QuoteProductsSchema)
  .merge(QuoteQuantitiesSchema)

export type AdminQuoteCreateSchemaType = z.infer<typeof AdminQuoteCreateSchema>

export const QuotePartnerFields = ["partner_id"] as const
export const QuoteBuyerFields = [
  "buyer_email",
  "recipient_name",
  "recipient_company",
  "partner_note",
  "region_id",
  "currency_code",
  "destination_country_code",
  "destination_postal_code",
  "destination_city",
  "ttl_days",
] as const
export const QuoteProductFields = ["product_ids"] as const
