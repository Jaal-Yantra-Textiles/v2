import { z } from "@medusajs/framework/zod"

/**
 * Mirrors `apps/backend/src/api/partners/quotes/validators.ts`.
 *
 * 🔑 There is no `customer_id` here, deliberately — the mint find-or-creates
 * the buyer BY EMAIL, scoped to the store (`mint-quote.ts`). Picking an
 * existing customer and typing their address are the same request. The picker
 * exists so a typo cannot silently create a second customer.
 */
/**
 * The DDP rule, mirrored from `dutyUndertakingRefinement` in the backend
 * validators (#1447).
 *
 * 🔴 Mirrored rather than skipped because the wizard is where the promise is
 * made. `duties_prepaid` alone tells the buyer "nothing further to pay on
 * delivery" and adds nothing to the price, so the duty comes out of margin by
 * an amount nobody computed. The backend refuses it either way — this is what
 * makes the refusal legible on the field instead of arriving as a failed mint.
 *
 * `0` is a real answer (AI-ECTA: Indian textiles enter Australia duty-free),
 * which is why the basis is required with it: a bare 0 cannot say whether it
 * means "checked, nil" or "left blank".
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
  partner_note: z.string().optional(),

  destination_country_code: z.string().min(2),
  destination_postal_code: z.string().optional(),
  destination_city: z.string().optional(),

  currency_code: z.string().min(3),
  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),

  /**
   * The deposit share of this deal, 0-100 (#1439 S11).
   *
   * Left blank means "no terms named", and the split falls through to the
   * platform's 30% at accept time. `0` is a real answer — invoice the lot
   * later — so the field must be able to hold a zero without it reading as
   * empty, which is why nothing here coerces falsy to undefined.
   */
  deposit_pct: z.number().min(0).max(100).optional(),

  /**
   * Freight named by hand, in the QUOTE currency (#1439 S12).
   *
   * 🔴 Positive, never 0 — a zero is free international shipping typed by
   * accident, and this system has already shipped bulk orders free once from a
   * rule-gated `0 INR` row (#1430).
   */
  freight_override_amount: z.number().positive().optional(),
  freight_basis: z.string().max(500).optional(),

  /**
   * DDP (#1447) — we pay the destination duty and import tax, and the buyer
   * pays nothing on arrival. Per quote, never a default: the shipment has to
   * actually clear DDP, arranged by hand until a carrier can price it.
   */
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
 * Quantity per variant, keyed by variant id. A blank or zero quantity is NOT a
 * zero-priced line — it means "not in this basket", and is dropped before the
 * request is built. The backend applies the same rule one level down: a line
 * whose amount cannot be resolved is dropped, never zeroed, because a zero
 * would mint an ACTIVE price of zero that the cart would honour.
 */
export const QuoteQuantitiesSchema = z.object({
  quantities: z.record(z.string(), z.number().nullish()),

  /**
   * The trade price, per variant (#1446). Both are optional and mutually
   * exclusive per line — the backend refuses both together rather than ranking
   * them, so "which wins" has no answer to get wrong here either.
   *
   * 🔑 `overrides` is a unit price in the PARTNER STORE's default currency, not
   * the quote's. A partner negotiating in Mumbai thinks in rupees whatever the
   * buyer is being quoted in; the conversion happens once, at mint, at a rate
   * the quote records.
   *
   * A blank cell is not a zero. Same rule as the quantity above: it means "no
   * override", and it is dropped rather than sent — a 0 would ask the backend
   * to mint an ACTIVE price of zero, which it refuses outright.
   */
  discounts: z.record(z.string(), z.number().nullish()),
  overrides: z.record(z.string(), z.number().nullish()),
})

/**
 * ⚠️ Merged from the SHAPE and re-refined. `.merge()` on an already-refined
 * schema drops the cross-field rule silently, and the rule it drops is the one
 * that stops a DDP quote promising duty cover with no amount behind it.
 */
export const QuoteCreateSchema = QuoteBuyerShape.merge(QuoteProductsSchema)
  .merge(QuoteQuantitiesSchema)
  .superRefine(dutyUndertakingRefinement)

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
  "deposit_pct",
  "freight_override_amount",
  "freight_basis",
  "duties_prepaid",
  "duty_rate_percent",
  "import_tax_rate_percent",
  "ddp_fee_total",
  "duty_basis",
] as const

export const QuoteProductFields = ["product_ids"] as const
export const QuoteQuantityFields = [
  "quantities",
  "discounts",
  "overrides",
] as const
