import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { annotateQuotableDesigns } from "../../../../modules/partner-quote/lib/quotable-designs"
import { listPartnerDesignsWorkflow } from "../../../../workflows/designs/list-partner-designs"
import { getPartnerFromAuthContext } from "../../helpers"

/**
 * The designs this partner can quote (#1486).
 *
 * ## Why a quote-scoped route and not a flag on `GET /partners/designs`
 *
 * That list is the partner's work queue — it is filtered, bucketed and paged
 * for a different job, and it is read by the design UI, the admin mirror and
 * the assistant. Hanging a per-row variant resolution off it would make every
 * one of those pay for a lookup none of them wants.
 *
 * This route reuses the SAME scoped listing workflow, so "which designs are
 * mine" has one answer, and adds only the quote question on top.
 *
 * 🔑 A static segment, so it must not be swallowed by `/partners/quotes/:id`.
 * The same collision already bit `readiness`, which is why there is a test
 * asserting the router does not resolve it as a quote id.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res
      .status(401)
      .json({ error: "Partner authentication required - no partner found" })
  }

  const q = req.query.q ? String(req.query.q) : undefined
  // Capped. The resolution is batched, but each row still carries a candidate
  // list, and a picker asking for a thousand designs is asking for a mistake.
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const { result } = await listPartnerDesignsWorkflow(req.scope).run({
    input: {
      partnerId: partner.id,
      q,
      offset,
      limit,
      locale: (req as any).locale,
    } as any,
  })

  const designs = await annotateQuotableDesigns(req.scope, {
    designs: (result as any)?.designs ?? [],
    partner_id: partner.id,
  })

  res.json({
    designs,
    count: (result as any)?.count ?? designs.length,
    limit,
    offset,
  })
}
