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
