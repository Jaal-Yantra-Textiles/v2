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

export const PartnerMintQuoteReq = z.object({
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

  currency_code: z.string().min(3),
  region_id: z.string().nullish(),
  carrier: z.string().optional(),

  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),
})

/**
 * The readiness preflight body (#1445).
 *
 * 🔑 Derived from the mint schema, not restated. It is deliberately the mint
 * body minus the fields a dry run has no use for — the buyer's identity and
 * the TTL. If the two drifted, the preflight would validate a shape the mint
 * rejects, which is worse than having no preflight: it would tell a partner
 * their quote is ready and then refuse it.
 */
export const QuoteReadinessReq = PartnerMintQuoteReq.omit({
  buyer_email: true,
  recipient_name: true,
  recipient_company: true,
  partner_note: true,
  ttl_days: true,
})

export type QuoteReadinessReqType = z.infer<typeof QuoteReadinessReq>
