import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../../../modules/socials"

/**
 * GET /admin/social-platforms/:id/google/ads/campaigns?customer_id=...
 *
 * Lists synced GoogleAdsCampaign rows. `customer_id` is optional; when
 * omitted we return campaigns for every CID under this SocialPlatform.
 *
 * Resolution path:
 *   campaign.customer_id (FK row id) → google_ads_customer rows scoped to
 *   the platform_id → filter campaigns to those customer row ids.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  const customerCidQuery = (req.query?.customer_id as string) || undefined
  const customerFilters: Record<string, any> = { platform_id: req.params.id }
  if (customerCidQuery) {
    customerFilters.customer_id = customerCidQuery
  }
  const customers = await socials.listGoogleAdsCustomers(customerFilters, {
    take: 100,
  })
  if (customers.length === 0) {
    res.status(200).json({ campaigns: [], count: 0, customers: [] })
    return
  }

  const customerRowIds = customers.map((c: any) => c.id)
  const [campaigns, count] = await socials.listAndCountGoogleAdsCampaigns(
    { customer_id: customerRowIds },
    {
      take: 200,
      order: { name: "ASC" },
    }
  )

  res.status(200).json({ campaigns, count, customers })
}

/**
 * POST /admin/social-platforms/:id/google/ads/campaigns
 *
 * Reserved for future manual edits (e.g., paused/enabled toggles pushed
 * back to Google). Returns 405 today so the route is registered and the
 * surface is discoverable.
 */
export const POST = async (_req: MedusaRequest, _res: MedusaResponse) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Mutating Google Ads campaigns from this endpoint is not yet supported"
  )
}
