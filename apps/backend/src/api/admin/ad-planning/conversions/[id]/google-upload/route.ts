import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { AD_PLANNING_MODULE } from "../../../../../../modules/ad-planning"
import { SOCIALS_MODULE } from "../../../../../../modules/socials"
import { uploadGoogleAdsConversionWorkflow } from "../../../../../../workflows/google-ads/upload-conversion"

type RetryBody = {
  /**
   * Optional override — when omitted we resolve in this order:
   *   1. conversion.metadata.google_ads_platform_id
   *   2. The single google-category SocialPlatform with upload defaults set
   */
  platform_id?: string
}

/**
 * POST /admin/ad-planning/conversions/:id/google-upload
 *
 * Manually re-runs the Google Ads conversion upload for this conversion.
 * Same workflow the conversion-created subscriber dispatches, exposed as
 * an admin action so operators can retry after fixing config without
 * waiting for a new conversion.
 *
 * Returns the upload result so the UI can render the status without
 * re-fetching the conversion to pick up the metadata stamps. The metadata
 * is also written by the workflow itself for the next page load.
 */
export const POST = async (
  req: MedusaRequest<RetryBody>,
  res: MedusaResponse
) => {
  const { id } = req.params
  const body = (req.body || {}) as RetryBody

  const adPlanning = req.scope.resolve(AD_PLANNING_MODULE) as any
  const [conversion] = await adPlanning.listConversions({ id })
  if (!conversion) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Conversion ${id} not found`
    )
  }

  const meta = (conversion.metadata || {}) as Record<string, any>

  const platformId =
    body.platform_id?.trim() ||
    meta.google_ads_platform_id ||
    (await resolveSinglePlatform(req.scope))

  if (!platformId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Could not resolve a Google platform — pass platform_id, set conversion.metadata.google_ads_platform_id, or configure upload defaults on exactly one google platform"
    )
  }

  const { result } = await uploadGoogleAdsConversionWorkflow(req.scope).run({
    input: {
      platform_id: platformId,
      conversion_id: id,
    },
  })

  res.status(200).json(result)
}

async function resolveSinglePlatform(scope: any): Promise<string | null> {
  const socials = scope.resolve(SOCIALS_MODULE) as any
  const candidates = await socials.listSocialPlatforms(
    { category: "google" },
    { take: 10 }
  )
  const eligible = candidates.filter((p: any) => {
    const cfg = (p.api_config || {}) as Record<string, any>
    if (!cfg.developer_token_encrypted) return false
    const ga = (cfg.google_ads || {}) as Record<string, any>
    return !!(ga.default_customer_id || ga.default_conversion_action)
  })
  return eligible.length === 1 ? eligible[0].id : null
}
