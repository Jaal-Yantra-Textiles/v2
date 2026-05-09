import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { syncGoogleAdsWorkflow } from "../../../../../../../workflows/google-ads/sync-google-ads"

type SyncBody = {
  /** Optional: scope sync to a single CID (must match an existing `ads` binding) */
  customer_id?: string
}

/**
 * POST /admin/social-platforms/:id/google/ads/sync
 *
 * Pulls campaigns + ad groups for every Google Ads binding on this row (or
 * just the one matching `customer_id` in the body) and upserts them into
 * google_ads_customer / google_ads_campaign / google_ads_ad_group.
 *
 * Returns counts + per-CID errors so the operator can see partial failures
 * inline without tailing logs.
 */
export const POST = async (
  req: MedusaRequest<SyncBody>,
  res: MedusaResponse
) => {
  const body = (req.body || {}) as SyncBody

  const customerId = body.customer_id?.trim()
  if (customerId !== undefined && customerId.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "customer_id, when provided, must be a non-empty CID"
    )
  }

  const { result } = await syncGoogleAdsWorkflow(req.scope).run({
    input: {
      platform_id: req.params.id,
      customer_id: customerId,
    },
  })

  res.status(200).json(result)
}
