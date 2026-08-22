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

/**
 * The DDP rule, mirrored from `dutyUndertakingRefinement` in
 * `src/api/partners/quotes/validators.ts` (#1447).
 *
 * 🔴 `duties_prepaid` alone tells the buyer "nothing further to pay on
 * delivery" and adds nothing to the price — the duty is absorbed out of margin
 * by an amount nobody computed. The backend refuses it; this is what puts the
 * refusal on the field rather than at the end of a failed mint.
 */
export const dutyUndertakingRefinement = (
  value: {
    duties_prepaid?: boolean
    duty_total?: number | null
    duty_basis?: string | null
  },
  ctx: z.RefinementCtx
) => {
  const prepaid = Boolean(value.duties_prepaid)
  const hasAmount = value.duty_total !== null && value.duty_total !== undefined

  if (prepaid && !hasAmount) {
    ctx.addIssue({
      code: "custom",
      message:
        "Enter the duty we are absorbing on this quote — 0 is fine where the lane is duty-free.",
      path: ["duty_total"],
    })
  }

  if (prepaid && !String(value.duty_basis ?? "").trim()) {
    ctx.addIssue({
      code: "custom",
      message:
        "Say how the figure was reached — whoever pays the customs invoice is not who typed it.",
      path: ["duty_basis"],
    })
  }

  if (!prepaid && hasAmount) {
    ctx.addIssue({
      code: "custom",
      message:
        "A duty amount only applies on a DDP quote. Without it the buyer pays duty at their own border.",
      path: ["duty_total"],
    })
  }
}

export const QuoteBuyerShape = z.object({
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

  /** DDP (#1447) — per quote, never a default. See the refinement above. */
  duties_prepaid: z.boolean().optional(),
  duty_total: z.number().min(0).nullish(),
  duty_basis: z.string().max(500).nullish(),
})

export const QuoteBuyerSchema = QuoteBuyerShape.superRefine(
  dutyUndertakingRefinement
)

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

/**
 * ⚠️ Merged from the SHAPE and re-refined — `.merge()` on a refined schema drops
 * the cross-field rule in silence, and the rule it drops is the DDP one.
 */
export const AdminQuoteCreateSchema = QuotePartnerSchema.merge(QuoteBuyerShape)
  .merge(QuoteProductsSchema)
  .merge(QuoteQuantitiesSchema)
  .superRefine(dutyUndertakingRefinement)

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
  "duties_prepaid",
  "duty_total",
  "duty_basis",
] as const
export const QuoteProductFields = ["product_ids"] as const
