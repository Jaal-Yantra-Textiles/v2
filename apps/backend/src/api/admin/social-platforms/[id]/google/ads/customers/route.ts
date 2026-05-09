import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../../../modules/socials"

/**
 * GET /admin/social-platforms/:id/google/ads/customers
 *
 * Returns the GoogleAdsCustomer rows we've synced for this SocialPlatform —
 * one row per CID. Use this to drive the picker in ad-planning UI without
 * re-querying Google's API on every render.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socials = req.scope.resolve(SOCIALS_MODULE) as any

  const [customers, count] = await socials.listAndCountGoogleAdsCustomers(
    { platform_id: req.params.id },
    {
      take: 100,
      order: { descriptive_name: "ASC", customer_id: "ASC" },
    }
  )

  res.status(200).json({ customers, count })
}
