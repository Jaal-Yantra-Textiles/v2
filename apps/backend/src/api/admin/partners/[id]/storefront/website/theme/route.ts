/**
 * @file Admin write: a partner's storefront theme (#2061).
 * @module API/Admin/Partners/Storefront/Website/Theme
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { resolvePartnerWebsiteWorkflow } from "../../../../../../../workflows/partners/resolve-partner-website"
import { updateWebsiteWorkflow } from "../../../../../../../workflows/website/update-website"
import { triggerStorefrontRevalidate } from "../../../../../../partners/storefront/helpers"
import { deepMergeTheme } from "../../../../../../partners/storefront/website/theme/merge-theme"
import { WebsiteTheme } from "../../../../../../partners/storefront/website/theme/validators"
import { getPartnerInspectionRecord } from "../../../lib/partner-inspection"

/**
 * PUT /admin/partners/:id/storefront/website/theme
 *
 * The operator twin of `PUT /partners/storefront/website/theme`: same schema,
 * same one-level deep merge, same root revalidation. It exists because the
 * storefront's logo, store name, hero and home sections live ONLY in
 * `website.theme`, and until now only the partner's own login could write it —
 * `update_partner`'s `logo` never reaches the storefront nav, and
 * `PUT /admin/websites/:id` strips `theme` from its body.
 */
export const PUT = async (
  req: MedusaRequest<WebsiteTheme>,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params

  const partner = await getPartnerInspectionRecord(partnerId, req.scope)

  const { result: resolution } = await resolvePartnerWebsiteWorkflow(
    req.scope
  ).run({ input: { partner } })

  if (!resolution.website) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      resolution.message || `Partner ${partnerId} has no storefront website`
    )
  }

  const website = resolution.website
  const incoming = req.validatedBody as WebsiteTheme
  const existing = website.theme || website.metadata?.theme || {}
  const merged = deepMergeTheme(existing, incoming)

  const { errors } = await updateWebsiteWorkflow(req.scope).run({
    input: {
      id: website.id,
      theme: merged,
    },
  })

  if (errors.length > 0) {
    throw errors[0]
  }

  // Awaited for the same reason as the partner route: the save is persisted
  // either way, and `revalidation` says whether it is visible yet.
  const revalidation = await triggerStorefrontRevalidate(website, {
    paths: ["/"],
  })

  res.json({ website_id: website.id, theme: merged, revalidation })
}
