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
    duty_rate_percent?: number | null
    import_tax_rate_percent?: number | null
    duty_total?: number | null
    import_tax_total?: number | null
    ddp_fee_total?: number | null
    duty_basis?: string | null
  },
  ctx: z.RefinementCtx
) => {
  const prepaid = Boolean(value.duties_prepaid)
  const given = (v: unknown) => v !== null && v !== undefined
  const hasDuty = given(value.duty_rate_percent) || given(value.duty_total)
  const hasImportTax =
    given(value.import_tax_rate_percent) || given(value.import_tax_total)

  if (prepaid && !hasDuty) {
    ctx.addIssue({
      code: "custom",
      message: "Enter the duty rate for this destination — 0% is fine where the lane is duty-free.",
      path: ["duty_rate_percent"],
    })
  }

  if (prepaid && !hasImportTax) {
    ctx.addIssue({
      code: "custom",
      message:
        "Enter the destination import tax rate. It is usually the biggest of the three — 21% VAT on goods + freight + duty against an 8% duty — so leaving it out under-funds most of the promise.",
      path: ["import_tax_rate_percent"],
    })
  }

  if (prepaid && !String(value.duty_basis ?? "").trim()) {
    ctx.addIssue({
      code: "custom",
      message: "Say how you got these rates — whoever pays the customs invoice is not who typed them.",
      path: ["duty_basis"],
    })
  }

  if (!prepaid && (hasDuty || hasImportTax || given(value.ddp_fee_total))) {
    ctx.addIssue({
      code: "custom",
      message:
        "These only apply on a DDP quote. Without it the buyer pays duty and import tax at their own border.",
      path: ["duty_rate_percent"],
    })
  }
}

export const QuoteBuyerShape = z.object({
  buyer_email: z.string().email(),
  recipient_name: z.string().optional(),
  recipient_company: z.string().optional(),
  /**
   * The buyer's own registration, for the document header. No format check,
   * mirroring the backend — it changes no number on the quote, and a per-scheme
   * regex would refuse valid registrations nobody validates against anyway.
   */
  buyer_tax_id: z.string().optional(),
  buyer_tax_id_type: z.string().optional(),
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

  /**
   * The deposit share of this deal, 0-100 (#1439 S11).
   *
   * Blank means no terms were named and the platform's 30% applies at
   * acceptance. `0` is a real answer — invoice the lot later — so nothing on
   * this field may coerce a falsy value to undefined.
   */
  deposit_pct: z.number().min(0).max(100).optional(),

  /**
   * Freight named by hand, in the QUOTE currency (#1439 S12).
   *
   * 🔴 Positive, never 0 — a zero here is free international shipping typed by
   * accident, and this system has already shipped bulk orders free once from a
   * rule-gated `0 INR` row (#1430).
   */
  freight_override_amount: z.number().positive().optional(),
  freight_basis: z.string().max(500).optional(),

  /**
   * Which carrier is asked for live rates on this quote.
   *
   * 🔑 Empty means the platform default (Shiprocket), which is what every quote
   * minted before this used. It is NOT "no freight": manual/flat shipping
   * options are always included whatever this says, so a lane with no carrier
   * answer still prices — see `lib/shipping-estimate.ts`.
   *
   * Free text rather than an enum on purpose: the picker offers the carriers
   * this deployment actually has, and "manual" for a lane priced by hand, but a
   * carrier registered after this build must still be typeable.
   */
  carrier: z.string().max(60).optional(),

  /** DDP (#1447) — per quote, never a default. See the refinement above. */
  duties_prepaid: z.boolean().optional(),
  /**
   * Rates, not amounts. The mint computes the money against the basket it
   * actually prices — duty on goods + freight, import tax on goods + freight +
   * duty — because this form cannot know either figure before then, and a
   * client-side estimate frozen as a commitment is worse than no preview.
   */
  duty_rate_percent: z.number().min(0).max(100).nullish(),
  import_tax_rate_percent: z.number().min(0).max(100).nullish(),
  /** The carrier's charge for advancing duty and tax. An amount, not a rate. */
  ddp_fee_total: z.number().min(0).nullish(),
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

  /**
   * variant_id → design_id, for lines picked as a DESIGN (#1486). Keyed by
   * variant like every other per-line map here, so there is one basket rather
   * than two that have to be kept in step.
   */
  design_by_variant: z.record(z.string(), z.string()).optional(),
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
  "buyer_tax_id",
  "buyer_tax_id_type",
  "partner_note",
  "region_id",
  "currency_code",
  "destination_country_code",
  "destination_postal_code",
  "destination_city",
  "ttl_days",
  "deposit_pct",
  "carrier",
  "freight_override_amount",
  "freight_basis",
  "duties_prepaid",
  "duty_rate_percent",
  "import_tax_rate_percent",
  "ddp_fee_total",
  "duty_basis",
] as const
export const QuoteProductFields = ["product_ids", "design_by_variant"] as const
