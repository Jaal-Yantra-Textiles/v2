/**
 * @file Admin read-proxy: a partner's storefront pages (#843).
 * @module API/Admin/Partners/Storefront/Pages
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { listPageWorkflow } from "../../../../../../workflows/website/website-page/list-page"
import { resolvePartnerWebsiteWorkflow } from "../../../../../../workflows/partners/resolve-partner-website"
import { getPartnerInspectionRecord } from "../../lib/partner-inspection"

/**
 * GET /admin/partners/:id/storefront/pages
 *
 * The inspection mirror of `GET /partners/storefront/pages`: same query
 * contract (`q`, `status`, `page_type`, `limit`, `offset`), same
 * `listPageWorkflow`, same response shape — the partner route already ran that
 * workflow, so only resolving WHICH website differs.
 *
 * A partner with no provisioned storefront (or a provisioned one with no
 * website yet) reads as an EMPTY LIST here, not the 404 the partner surface
 * throws. That is deliberate and follows the same call as
 * `resolvePartnerInspectionStoreId`: "no storefront yet" is a normal state an
 * operator needs to see — it is what the onboarding flow exists to fix — not an
 * error. `website_id: null` makes the state explicit rather than implied by an
 * empty list.
 *
 * READ-ONLY. There is deliberately no POST: creating a page on a partner's
 * behalf is the audited impersonation track (approach #1 on #843).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  const { q, status, page_type } = req.query
  const offset = parseInt(req.query.offset as string) || 0
  const limit = parseInt(req.query.limit as string) || 20

  const partner = await getPartnerInspectionRecord(partnerId, req.scope)

  const { result: resolution } = await resolvePartnerWebsiteWorkflow(
    req.scope
  ).run({ input: { partner } })

  if (!resolution.website) {
    return res.json({
      pages: [],
      count: 0,
      offset,
      limit,
      hasMore: false,
      website_id: null,
      reason: resolution.reason,
    })
  }

  const { result } = await listPageWorkflow(req.scope).run({
    input: {
      website_id: resolution.website.id,
      filters: {
        title: q,
        status,
        page_type,
      },
      config: {
        skip: offset,
        take: limit,
      },
    },
  })

  const [pages, count] = result

  res.json({
    pages,
    count,
    offset,
    limit,
    hasMore: offset + pages.length < count,
    website_id: resolution.website.id,
  })
}
