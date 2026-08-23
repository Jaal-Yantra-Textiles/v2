import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { annotateQuotableDesigns } from "../../../../modules/partner-quote/lib/quotable-designs"

/**
 * The designs an admin can quote (#1486).
 *
 * 🔑 Unscoped by partner, like the admin mint: an admin legitimately quotes a
 * design the producing partner does not own. `partner_id` narrows the list when
 * given — the wizard passes the partner already chosen — but it is a filter,
 * not a permission, and the resolved variant is still asserted to be in that
 * partner's sales channel when the quote is actually minted.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const q = req.query.q ? String(req.query.q).trim() : ""
  const partnerId = req.query.partner_id ? String(req.query.partner_id) : null
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50)
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

  const filters: Record<string, any> = {}
  // Only when given. `filters: { owner_partner_id: undefined }` is NO filter
  // rather than "no rows" (#1433), which here would be the right answer by
  // accident — but the same shape has already served one tenant's data to
  // another, so it is written explicitly either way.
  if (partnerId) filters.owner_partner_id = partnerId
  if (q) filters.name = { $ilike: `%${q}%` }

  const { data: designs = [], metadata } = await query.graph({
    entity: "design",
    fields: ["id", "name", "status", "thumbnail_url", "product_type"],
    filters,
    pagination: { skip: offset, take: limit, order: { name: "ASC" } },
  })

  const annotated = await annotateQuotableDesigns(req.scope, {
    designs: designs as any[],
    partner_id: null,
  })

  res.json({
    designs: annotated,
    count: (metadata as any)?.count ?? annotated.length,
    limit,
    offset,
  })
}
