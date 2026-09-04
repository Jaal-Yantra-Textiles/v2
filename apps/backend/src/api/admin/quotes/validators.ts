import { z } from "@medusajs/framework/zod"

import {
  dutyUndertakingRefinement,
  PartnerMintQuoteShape,
  QuoteReadinessShape,
} from "../../partners/quotes/validators"

/**
 * The admin mint body (#1389 S5).
 *
 * 🔑 Extends the PARTNER schema rather than restating it. A hand-copied twin
 * would drift the first time a field changed, and the fields it carries decide
 * a price — `ttl_days` bounds a live price list's lifetime, `lines` decides
 * whose prices get frozen. One schema, one place to change.
 *
 * The only addition is `partner_id`: an admin has no partner of their own, so
 * the quote's owner has to be named explicitly.
 *
 * ⚠️ It extends the SHAPE and re-applies `dutyUndertakingRefinement`. `.extend`
 * on an already-refined schema is what drops cross-field rules silently, and the
 * rule this drops is the one that stops a DDP quote promising duty cover with no
 * amount behind it (#1447).
 */
export const AdminMintQuoteReq = PartnerMintQuoteShape.extend({
  partner_id: z.string().min(1),
}).superRefine(dutyUndertakingRefinement)

export type AdminMintQuoteReqType = z.infer<typeof AdminMintQuoteReq>

/**
 * The admin readiness body (#1445). Same addition as the mint: an admin has no
 * partner of their own, so the one being quoted for must be named — and on this
 * surface that partner is exactly what the catalogue check validates against.
 */
export const AdminQuoteReadinessReq = QuoteReadinessShape.extend({
  partner_id: z.string().min(1),
}).superRefine(dutyUndertakingRefinement)

export type AdminQuoteReadinessReqType = z.infer<typeof AdminQuoteReadinessReq>


/**
 * Creating a DRAFT (#1446).
 *
 * ## Why this is not the mint schema with everything optional
 *
 * The draft-order rail this mirrors captures, in its create modal, exactly what
 * is needed to MAKE THE ROW — region, sales channel, customer, address — and
 * nothing else. Items arrive afterwards, on the draft.
 *
 * 🔑 The required set here is not a taste judgement: it is the table's NOT NULL
 * columns. `partner_quote` requires `partner_id`, `destination_country_code`
 * and `currency_code`, and everything else is nullable. So those three are
 * required and the rest are not — which is also why the modal asks for a region
 * first, since the region is what supplies the currency.
 *
 * ⚠️ NOT `.optional()` over a NOT NULL column. That combination is a 500 with an
 * HTML body and no field name, diagnosable only from CloudWatch (#1737) — the
 * schema has to agree with the constraint, not merely be permissive.
 */
export const AdminCreateQuoteDraftReq = z.object({
  partner_id: z.string().min(1),
  destination_country_code: z.string().min(1),
  currency_code: z.string().min(1),
  region_id: z.string().nullish(),
  destination_postal_code: z.string().nullish(),
  destination_city: z.string().nullish(),
  buyer_email: z.string().email().nullish(),
  recipient_name: z.string().nullish(),
  recipient_company: z.string().nullish(),
  buyer_tax_id: z.string().nullish(),
  buyer_tax_id_type: z.string().nullish(),
  partner_note: z.string().nullish(),
  ttl_days: z.number().int().positive().nullish(),
  /**
   * 🔑 `nullish`, and read with `??` at the far end — never `||`. A 0% deposit
   * is a real commercial term, and `||` would send it as "unset", which the
   * backend resolves to the 30% platform default.
   */
  deposit_pct: z.number().min(0).max(100).nullish(),
})

export type AdminCreateQuoteDraftReqType = z.infer<
  typeof AdminCreateQuoteDraftReq
>

/**
 * A section saving its own answers (#1446).
 *
 * Every field is optional because a section only ever sends its own — the
 * buyer section must not have to restate the destination in order to save a
 * company name. `lines` is a WHOLE-BASKET replacement rather than a patch of
 * individual rows: the items section owns the basket, and a partial line edit
 * would need identities the browser does not have.
 */
export const AdminUpdateQuoteDraftReq = AdminCreateQuoteDraftReq.partial().extend(
  {
    lines: z
      .array(
        z.object({
          variant_id: z.string().min(1),
          quantity: z.number().int().positive(),
          product_id: z.string().nullish(),
          design_id: z.string().nullish(),
          position: z.number().int().min(0).nullish(),
          unit_weight_grams: z.number().positive().nullish(),
          discount_percent: z.number().min(0).max(100).nullish(),
          override_unit_amount: z.number().positive().nullish(),
        })
      )
      .nullish(),
    duties_prepaid: z.boolean().nullish(),
    duty_rate_percent: z.number().min(0).nullish(),
    import_tax_rate_percent: z.number().min(0).nullish(),
    ddp_fee_total: z.number().min(0).nullish(),
    duty_basis: z.string().nullish(),
    quoted_shipping_option_id: z.string().nullish(),
  }
)

export type AdminUpdateQuoteDraftReqType = z.infer<
  typeof AdminUpdateQuoteDraftReq
>
