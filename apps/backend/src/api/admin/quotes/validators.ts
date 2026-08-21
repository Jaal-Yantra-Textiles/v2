import { z } from "@medusajs/framework/zod"

import { PartnerMintQuoteReq } from "../../partners/quotes/validators"

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
 */
export const AdminMintQuoteReq = PartnerMintQuoteReq.extend({
  partner_id: z.string().min(1),
})

export type AdminMintQuoteReqType = z.infer<typeof AdminMintQuoteReq>
