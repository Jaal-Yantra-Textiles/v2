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
/**
 * The line's FIELDS, before the cross-field refinements.
 *
 * 🔑 Exported so the MCP tool schema can be checked against it. The tools'
 * coverage test compares top-level body keys to the mint validator, but a
 * quote's real vocabulary is mostly INSIDE a line — and the nested half went
 * unchecked until `unit_weight_grams` was found missing from the tool schema,
 * which is the one field a design-led quote cannot be priced without.
 * `.refine()` returns a ZodEffects with no `.shape`, so the raw object has to
 * be named to be readable.
 */
export const QuoteLineShape = z
  .object({
    /**
     * Optional ONLY because a line may name a `design_id` instead — see the
     * refinement below. An explicit variant always wins: it is how a design
     * sold as several variants gets quoted at all.
     */
    variant_id: z.string().min(1).nullish(),
    /**
     * Quote this design (#1486). The server resolves it to the variant the
     * design is sold through and refuses when that is not decidable — a design
     * with no product behind it has nothing to price, and one sold as several
     * variants must not be quoted as whichever came back first.
     */
    design_id: z.string().min(1).nullish(),
    quantity: z.number().int().positive(),
    position: z.number().int().nonnegative().optional(),
    note: z.string().nullish(),

    /** 0-100, off the live catalog price at this line's quantity. */
    discount_percent: z.number().min(0).max(100).nullish(),
    /** A flat unit price, in the partner store's default currency. */
    override_unit_amount: z.number().positive().nullish(),

    /**
     * The weight of ONE unit of this line, in grams, typed by the operator.
     *
     * 🔴 Exists because refusing was the only other answer. Freight is quoted
     * against the summed basket weight and `buildShippingEstimate` refuses the
     * WHOLE basket on the first line it cannot weigh — 183 variants platform-
     * wide carry no weight at either level, and a design quoted before its
     * garment has ever been weighed has none by definition. Without this, a
     * design-led quote simply cannot be priced.
     *
     * 🔑 Positive, never 0. A zero here is a weightless consignment, which
     * every carrier rates at its floor — the same shape as the `0 INR` freight
     * row that shipped bulk orders free (#1430). Absent means "no figure",
     * which the estimate already knows how to refuse loudly.
     *
     * Prices THIS quote and is never written back to the variant: a figure
     * typed under time pressure must not become the catalogue's answer for
     * every future basket.
     */
    unit_weight_grams: z.number().positive().max(1_000_000).nullish(),
  })

/** The line as the routes accept it: the shape plus its cross-field rules. */
const QuoteLine = QuoteLineShape
  .refine((l) => Boolean(l.variant_id) || Boolean(l.design_id), {
    message: "A line must name either a variant_id or a design_id.",
    path: ["variant_id"],
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
 * ## Three charges, not one
 *
 * DHL's landed-cost planner on a 70,000 INR consignment to NL: duty 6,143 (8%
 * of goods + freight), import VAT 17,416 (21% of goods + freight + duty), and
 * a 1,982 carrier fee for advancing them. 🔴 **The duty is the small half.** A
 * partner who funds only the duty under-writes "nothing further to pay" by
 * roughly three quarters of its value, and nobody finds out, because the
 * shortfall lands on margin rather than on the buyer. So the schema requires a
 * duty answer AND an import-tax answer, each of which may be `0` when the lane
 * genuinely carries none.
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
  body: {
    duties_prepaid?: boolean | null
    duty_total?: number | null
    duty_rate_percent?: number | null
    import_tax_total?: number | null
    import_tax_rate_percent?: number | null
    ddp_fee_total?: number | null
    duty_basis?: string | null
  },
  ctx: z.RefinementCtx
) => {
  const prepaid = Boolean(body.duties_prepaid)
  const given = (v: unknown) => v !== null && v !== undefined
  const hasDuty = given(body.duty_total) || given(body.duty_rate_percent)
  const hasImportTax =
    given(body.import_tax_total) || given(body.import_tax_rate_percent)

  if (prepaid && !hasDuty) {
    ctx.addIssue({
      code: "custom",
      message:
        "A DDP quote must say what duty we are absorbing — a rate (duty_rate_percent) or a flat duty_total. " +
        "Enter 0 with a duty_basis where the lane is genuinely duty-free (e.g. AI-ECTA into AU).",
      path: ["duty_rate_percent"],
    })
  }

  if (prepaid && !hasImportTax) {
    ctx.addIssue({
      code: "custom",
      message:
        "A DDP quote must also say what destination import tax we are absorbing (import_tax_rate_percent, or a flat import_tax_total). " +
        "It is usually the LARGEST of the three charges — 21% VAT on goods + freight + duty dwarfs an 8% duty — so funding only the duty under-writes the promise by most of its value. " +
        "Enter 0 where none is due.",
      path: ["import_tax_rate_percent"],
    })
  }

  if (prepaid && !String(body.duty_basis ?? "").trim()) {
    ctx.addIssue({
      code: "custom",
      message:
        "A DDP quote must carry duty_basis — how the figures were arrived at (e.g. \"EU: 8% duty, 21% NL VAT, HS 6304.92\"). " +
        "It is the only record of why we committed to these amounts, and whoever meets the customs invoice is not who typed them.",
      path: ["duty_basis"],
    })
  }

  if (given(body.duty_total) && given(body.duty_rate_percent)) {
    ctx.addIssue({
      code: "custom",
      message:
        "Give a duty RATE or a flat duty amount, never both — 'which one wins' is a question that should not have an answer.",
      path: ["duty_total"],
    })
  }

  if (given(body.import_tax_total) && given(body.import_tax_rate_percent)) {
    ctx.addIssue({
      code: "custom",
      message:
        "Give an import tax RATE or a flat amount, never both.",
      path: ["import_tax_total"],
    })
  }

  if (
    !prepaid &&
    (hasDuty || hasImportTax || given(body.ddp_fee_total))
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "Duty, import tax and the DDP fee are only valid with duties_prepaid. On a non-DDP quote the buyer pays them at their own border, so charging them here bills the same border twice.",
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
  /**
   * The buyer's own tax registration, as they stated it.
   *
   * 🔴 No format check, deliberately. A regex per scheme would refuse valid
   * registrations from countries the list has not caught up with, and this
   * number changes NOTHING about the price or the tax — quote tax follows the
   * seller's jurisdiction (#1447). It is a line on a document. Refusing a real
   * buyer's real number to enforce a pattern nobody validates against would be
   * a cost with no benefit.
   */
  buyer_tax_id: z.string().max(64).nullish(),
  buyer_tax_id_type: z.string().max(32).nullish(),
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
  /**
   * The rate form — preferred, because the amounts are then computed against
   * the basket the mint actually prices rather than the one the wizard guessed.
   * Capped at 100: a duty rate above that is a typo, and a typo here is a
   * liability we take on.
   */
  duty_rate_percent: z.number().min(0).max(100).nullish(),
  import_tax_rate_percent: z.number().min(0).max(100).nullish(),
  import_tax_total: z.number().min(0).nullish(),
  /** The carrier's advance/disbursement fee. An amount, never a rate. */
  ddp_fee_total: z.number().min(0).nullish(),

  /**
   * Freight named by hand, in the QUOTE currency (#1439 S12).
   *
   * 🔴 `.positive()`, not `.min(0)`. A zero here would be free international
   * shipping typed by accident, and this system has already shipped bulk orders
   * free once from a rule-gated `0 INR` row (#1430). Free freight, if it is
   * ever a real offer, should be a deliberate feature and not a slip of a
   * numeric field.
   *
   * Not required, and it must never become required: on a rateable lane the
   * estimate is the better answer, because nobody has to keep it current.
   */
  freight_override_amount: z.number().positive().nullish(),
  /** Who quoted it and on what basis. Evidence, like `duty_basis`. */
  freight_basis: z.string().max(500).nullish(),

  currency_code: z.string().min(3),
  region_id: z.string().nullish(),
  carrier: z.string().optional(),

  /** Drives `price_list.ends_at`, so expiry is native rather than swept. */
  ttl_days: z.number().int().positive().max(365).optional(),

  /**
   * The deposit share of this deal, 0-100 (#1439 S11).
   *
   * Omitted — or null — means the partner did not name terms, and the split
   * falls through to their house default and then the platform's 30%. `0` is a
   * real answer meaning "invoice the lot later", so the resolver checks for
   * null rather than falsiness. 100 is equally real and means paid up front.
   *
   * ⚠️ It must be listed HERE to exist at all. `zodValidator` forces `.strict()`
   * on the body, so a field the schema does not name is not merely ignored —
   * it never reaches the workflow, and the deal silently takes the default
   * terms while the wizard shows the number the partner typed.
   */
  deposit_pct: z.number().min(0).max(100).nullish(),
})

/**
 * Correct a quote in place, before the buyer accepts (adjustment).
 *
 * 🔑 Deliberately NOT the mint shape minus fields. An adjustment may only touch
 * what lives on the quote ROW; the basket and its prices live in a minted price
 * list guarded by the mint's re-read assertion, and a second way to write them
 * is a second way to cut prices platform-wide. See `adjust-quote.ts`.
 *
 * ⚠️ `zodValidator` forces `.strict()`, so a field absent here does not merely
 * get ignored — it never reaches the handler. Anything adjustable must be named.
 */
export const AdjustQuoteShape = z.object({
  /**
   * 🔴 `.positive()`, never `.min(0)`. A zero here is free international
   * shipping typed by accident, and this system has already shipped bulk orders
   * free once from a rule-gated `0` row (#1430). Send `null` to mean "leave it".
   */
  freight_amount: z.number().positive().nullish(),
  /** Who quoted it and on what basis — evidence, like `duty_basis`. */
  freight_basis: z.string().max(500).nullish(),
  partner_note: z.string().max(5000).nullish(),
  /** Absolute, not a delta. Moves the price list's `ends_at` with it. */
  expires_at: z.coerce.date().nullish(),
})

export const AdjustQuoteReq = AdjustQuoteShape.refine(
  (b) =>
    b.freight_amount !== undefined ||
    b.freight_basis !== undefined ||
    b.partner_note !== undefined ||
    b.expires_at !== undefined,
  {
    message:
      "An adjustment must change something — send freight_amount, freight_basis, partner_note or expires_at.",
  }
)

export type AdjustQuoteReqType = z.infer<typeof AdjustQuoteShape>

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
  // The buyer's registration is part of who they are, not of what the basket
  // costs — omitted for the same reason their email is.
  buyer_tax_id: true,
  buyer_tax_id_type: true,
  partner_note: true,
  ttl_days: true,
  // A dry run prices a basket; how it will be PAID for changes none of those
  // numbers. Omitted for the same reason the buyer's identity is.
  deposit_pct: true,
  // 🔑 `freight_override_amount` is deliberately KEPT — it decides whether the
  // lane has to be rateable, so a preflight without it would refuse exactly the
  // cross-border quotes an override exists to unblock. Only the basis is
  // dropped: it is evidence for the frozen row, and a dry run freezes nothing.
  freight_basis: true,
})

export const QuoteReadinessReq = QuoteReadinessShape.superRefine(
  dutyUndertakingRefinement
)

export type QuoteReadinessReqType = z.infer<typeof QuoteReadinessReq>

/**
 * Minting the made-to-order variant a custom design is quoted through (#1486).
 *
 * 🔴 This schema is not decoration — without it the route reads nothing at all.
 * Both mint routes were registered with no `validateAndTransformBody`, so
 * `req.validatedBody` was never populated; the client's JSON sat in `req.body`
 * unread, the route fell through to a `currency_code` query param nobody sends,
 * and every pick answered:
 *
 *   400 "currency_code is required — the variant has to be listed in the
 *        currency the quote is denominated in."
 *
 * The message was true about the requirement and wrong about the cause, which
 * is the worst kind: it sends you looking at the form for a field the form was
 * sending correctly all along.
 *
 * ⚠️ `zodValidator` forces `.strict()`, so this rejects unknown keys. Keep it
 * matching what the two pickers actually post.
 */
export const MintDesignVariantReq = z.object({
  /**
   * The quote's currency, not the design's. The estimate behind the price is
   * denominated in the design's `cost_currency` and is converted on the way
   * through — see `designQuoteUnitPrice`.
   */
  currency_code: z
    .string({
      // ⚠️ zod 4 — `error`, not `required_error`. Without it a MISSING key
      // reports "expected string, received undefined", so the two ways a
      // caller can omit a currency would explain themselves differently.
      error:
        "currency_code is required — the variant has to be listed in the currency the quote is denominated in.",
    })
    .min(
      1,
      "currency_code is required — the variant has to be listed in the currency the quote is denominated in."
    ),
  /**
   * Override the default uplift on the estimated cost. The wizards do not send
   * it; ops might.
   */
  markup_percent: z.number().min(0).optional(),
})

export type MintDesignVariantReqType = z.infer<typeof MintDesignVariantReq>
