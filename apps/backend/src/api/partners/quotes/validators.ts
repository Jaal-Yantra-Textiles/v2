import { z } from "@medusajs/framework/zod"

/**
 * One line of the basket, with its optional trade price (#1439 S7).
 *
 * 🔑 `override_unit_amount` is entered in the PARTNER STORE's default
 * currency, not the quote's. A partner negotiating in Mumbai thinks in rupees
 * whatever currency the buyer is being quoted in, so the number they type is
 * authoritative and the conversion happens once, at mint, at a rate persisted
 * beside the result.
 *
 * The two forms are mutually exclusive by construction. "Which one wins" is
 * not a question that should have an answer, so the schema refuses both rather
 * than ranking them — and `resolveLineOverride` refuses them again, because the
 * admin twin and any future caller reach the pure function too.
 *
 * 🔴 A resolved price of zero is refused downstream, not here. `0` is a valid
 * number and a plausible typo, and an ACTIVE price of zero is one the cart
 * cheerfully charges — see the note in `lib/line-override.ts`.
 */
const QuoteLine = z
  .object({
    variant_id: z.string().min(1),
    quantity: z.number().int().positive(),
    position: z.number().int().nonnegative().optional(),
    note: z.string().nullish(),

    /** 0-100, off the live catalog price at this line's quantity. */
    discount_percent: z.number().min(0).max(100).nullish(),
    /** A flat unit price, in the partner store's default currency. */
    override_unit_amount: z.number().positive().nullish(),
  })
  .refine(
    (l) =>
      !(
        l.discount_percent !== null &&
        l.discount_percent !== undefined &&
        l.override_unit_amount !== null &&
        l.override_unit_amount !== undefined
      ),
    {
      message:
        "A line takes either a discount_percent or an override_unit_amount, never both.",
      path: ["override_unit_amount"],
    }
  )

/**
 * A quote may not promise duty cover without saying how much (#1447).
 *
 * 🔴 `duties_prepaid` on its own tells the buyer "import duty is included and
 * paid by us" and adds NOTHING to the price — the amount comes out of margin,
 * uncomputed, and nobody downstream learns a figure was ever owed. Nothing can
 * derive it for us yet (HS codes are incomplete; Shiprocket's tariff endpoint is
 * gated on CSB-5 KYC), so the number is entered by hand and the schema refuses
 * the promise without it.
 *
 * `0` is accepted and is a real answer — AI-ECTA makes Indian textiles duty-free
 * into Australia — which is exactly why `duty_basis` is required alongside it:
 * a bare 0 cannot say whether it means "checked, nil" or "left blank".
 *
 * The reverse is refused too. A duty amount on a quote that is NOT DDP would be
 * added to a total whose buyer was told duty is theirs to pay on arrival —
 * charging them twice for the same border.
 *
 * Shared by all four mint/readiness schemas rather than restated: a preflight
 * that accepted what the mint rejects would tell a partner their quote is ready
 * and then refuse it.
 */
export const dutyUndertakingRefinement = (
  body: { duties_prepaid?: boolean | null; duty_total?: number | null; duty_basis?: string | null },
  ctx: z.RefinementCtx
) => {
  const prepaid = Boolean(body.duties_prepaid)
  const hasAmount = body.duty_total !== null && body.duty_total !== undefined

  if (prepaid && !hasAmount) {
    ctx.addIssue({
      code: "custom",
      message:
        "A DDP quote must carry duty_total — the amount of destination duty we are undertaking to pay, in the quote currency. " +
        "Without it the buyer is promised duty cover that adds nothing to the price and is absorbed out of margin. " +
        "Enter 0 with a duty_basis where the lane is genuinely duty-free (e.g. AI-ECTA into AU).",
      path: ["duty_total"],
    })
  }

  if (prepaid && !String(body.duty_basis ?? "").trim()) {
    ctx.addIssue({
      code: "custom",
      message:
        "A DDP quote must carry duty_basis — how the figure was arrived at (e.g. \"EU 12% ad valorem, HS 6304.92\", \"AI-ECTA duty-free\"). " +
        "It is the only record of why we committed to this amount, and whoever meets the customs invoice is not who typed it.",
      path: ["duty_basis"],
    })
  }

  if (!prepaid && hasAmount) {
    ctx.addIssue({
      code: "custom",
      message:
        "duty_total is only valid with duties_prepaid. On a non-DDP quote the buyer pays duty at their own border, so adding it here charges them twice.",
      path: ["duty_total"],
    })
  }
}

/**
 * The mint body's SHAPE, before the cross-field rule.
 *
 * Kept as a plain object because the admin twin extends it and the readiness
 * preflight omits from it — neither survives on a refined schema.
 */
export const PartnerMintQuoteShape = z.object({
  buyer_email: z.string().email(),
  recipient_name: z.string().nullish(),
  recipient_company: z.string().nullish(),
  partner_note: z.string().nullish(),

  /** A quote is a basket. A single-product quote is a one-line quote. */
  lines: z.array(QuoteLine).min(1),

  destination_country_code: z.string().min(2),
  destination_postal_code: z.string().nullish(),
  destination_city: z.string().nullish(),
  /**
   * Quote this as DDP: we pay the destination duty and import tax, the buyer
   * pays nothing on arrival. Opt-in per quote — see the model docblock for why
   * it must never be a default.
   */
  duties_prepaid: z.boolean().optional(),
  /**
   * The duty we undertake to pay, in the QUOTE currency, and how that number
   * was reached. Required together with `duties_prepaid` — see
   * `dutyUndertakingRefinement`.
   */
  duty_total: z.number().min(0).nullish(),
  duty_basis: z.string().max(500).nullish(),

  currency_code: z.string().min(3),
  region_id: z.string().nullish(),
  carrier: z.string().optional(),

  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),
})

export const PartnerMintQuoteReq = PartnerMintQuoteShape.superRefine(
  dutyUndertakingRefinement
)

/**
 * The readiness preflight body (#1445).
 *
 * 🔑 Derived from the mint schema, not restated. It is deliberately the mint
 * body minus the fields a dry run has no use for — the buyer's identity and
 * the TTL. If the two drifted, the preflight would validate a shape the mint
 * rejects, which is worse than having no preflight: it would tell a partner
 * their quote is ready and then refuse it.
 */
export const QuoteReadinessShape = PartnerMintQuoteShape.omit({
  buyer_email: true,
  recipient_name: true,
  recipient_company: true,
  partner_note: true,
  ttl_days: true,
})

export const QuoteReadinessReq = QuoteReadinessShape.superRefine(
  dutyUndertakingRefinement
)

export type QuoteReadinessReqType = z.infer<typeof QuoteReadinessReq>
