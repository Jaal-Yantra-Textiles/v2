import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/ads
 * 
 * List all ads
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { ad_set_id, campaign_id, ad_account_id, limit = "200", offset = "0" } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (ad_set_id) {
      filters.ad_set_id = ad_set_id
    }

    let ads: any[] = []

    if (ad_account_id) {
      const accounts = await socials.listAdAccounts({ meta_account_id: ad_account_id })
      const adAccount = accounts?.[0]
        ? accounts[0]
        : (() => {
            try {
              return socials.retrieveAdAccount(ad_account_id) as any
            } catch {
              return null
            }
          })()

      const resolvedAccount = await Promise.resolve(adAccount)

      if (!resolvedAccount) {
        ads = []
      } else {
        const campaigns = await socials.listAdCampaigns({ ad_account_id: (resolvedAccount as any).id })
        const campaignIds = new Set((campaigns as any[]).map((c: any) => c.id))
        const allAdSets = await socials.listAdSets({}, { order: { name: "ASC" } })
        const adSetIds = new Set(
          (allAdSets as any[]).filter((as: any) => campaignIds.has(as.campaign_id)).map((as: any) => as.id)
        )

        const allAds = await socials.listAds({} as any)
        ads = (allAds as any[]).filter((a: any) => adSetIds.has(a.ad_set_id))
      }
    } else if (campaign_id) {
      const adSets = await socials.listAdSets({ campaign_id })
      const adSetIds = new Set((adSets as any[]).map((as: any) => as.id))
      const allAds = await socials.listAds({} as any)
      ads = (allAds as any[]).filter((a: any) => adSetIds.has(a.ad_set_id))
    } else {
      ads = await socials.listAds(filters)
    }

    const skip = parseInt(offset, 10) || 0
    const take = parseInt(limit, 10) || 200
    const paged = (ads as any[]).slice(skip, skip + take)

    res.json({
      ads: paged,
      count: paged.length,
      total: (ads as any[]).length,
      limit: take,
      offset: skip,
    })
  } catch (error: any) {
    console.error("Failed to list ads:", error)
    res.status(500).json({
      message: "Failed to list ads",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/ads
 * 
 * Create an ad
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const ad = await socials.createAds(body)

    res.json({ ad })
  } catch (error: any) {
    console.error("Failed to create ad:", error)
    res.status(500).json({
      message: "Failed to create ad",
      error: error.message,
    })
  }
}
