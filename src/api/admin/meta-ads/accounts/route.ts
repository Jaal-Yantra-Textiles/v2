import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import MetaAdsService from "../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../modules/socials/utils/token-helpers"

/**
 * GET /admin/meta-ads/accounts
 * 
 * List all synced ad accounts
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    
    const accounts = await socials.listAdAccounts({}, {
      order: { name: "ASC" },
    })

    res.json({
      accounts,
      count: accounts.length,
    })
  } catch (error: any) {
    console.error("Failed to list ad accounts:", error)
    res.status(500).json({
      message: "Failed to list ad accounts",
      error: error.message,
    })
  }
}
