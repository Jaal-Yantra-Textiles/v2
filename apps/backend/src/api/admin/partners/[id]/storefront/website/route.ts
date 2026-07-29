/**
 * @file Admin read-proxy: a partner's website + theme (#843).
 * @module API/Admin/Partners/Storefront/Website
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolvePartnerWebsiteWorkflow } from "../../../../../../workflows/partners/resolve-partner-website"
import { getPartnerInspectionRecord } from "../../lib/partner-inspection"

/**
 * GET /admin/partners/:id/storefront/website
 *
 * The inspection mirror of `GET /partners/storefront/website`, plus the theme
 * that `GET /partners/storefront/website/theme` returns — folded into one
 * response because the admin surface renders them together and both come from
 * the same resolved website record. The theme is read exactly as the partner
 * route reads it: dedicated `theme` column, legacy `metadata.theme` fallback.
 *
 * `preview_url` is the same URL the partner portal's theme editor builds for
 * its iframe (`?theme_editor=true`), so an operator sees the storefront in the
 * state the partner is editing it in, rather than the published state.
 *
 * READ-ONLY. The partner route backfills `website_id` when it resolves via the
 * domain fallback; this one surfaces that as `resolved_by: "domain"` and writes
 * nothing.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  const partner = await getPartnerInspectionRecord(partnerId, req.scope)

  const { result: resolution } = await resolvePartnerWebsiteWorkflow(
    req.scope
  ).run({ input: { partner } })

  if (!resolution.website) {
    return res.json({
      website: null,
      theme: null,
      preview_url: null,
      reason: resolution.reason,
      message: resolution.message,
    })
  }

  const website = resolution.website
  const domain = website.domain as string | null

  res.json({
    website,
    theme: website.theme || website.metadata?.theme || {},
    // Mirrors apps/partner-ui/src/routes/settings/theme/theme.tsx.
    preview_url: domain
      ? `${domain.startsWith("http") ? domain : `https://${domain}`}/?theme_editor=true`
      : null,
    resolved_by: resolution.resolved_by,
  })
}
