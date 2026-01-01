import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"

/**
 * GET /admin/meta-ads/adsets
 * 
 * List all ad sets
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const { campaign_id, ad_account_id, limit = "200", offset = "0" } = req.query as Record<string, string>
    
    const filters: Record<string, any> = {}
    if (campaign_id) {
      filters.campaign_id = campaign_id
    }

    let adSets: any[] = []

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
        adSets = []
      } else {
        const campaigns = await socials.listAdCampaigns({ ad_account_id: (resolvedAccount as any).id })
        const campaignIds = new Set((campaigns as any[]).map((c: any) => c.id))

        const allAdSets = await socials.listAdSets({}, { order: { name: "ASC" } })
        adSets = (allAdSets as any[]).filter((as: any) => campaignIds.has(as.campaign_id))
      }
    } else {
      adSets = (await socials.listAdSets(filters, { order: { name: "ASC" } })) as any[]
    }

    const skip = parseInt(offset, 10) || 0
    const take = parseInt(limit, 10) || 200
    const paged = adSets.slice(skip, skip + take)

    res.json({
      adSets: paged,
      count: paged.length,
      total: adSets.length,
      limit: take,
      offset: skip,
    })
  } catch (error: any) {
    console.error("Failed to list ad sets:", error)
    res.status(500).json({
      message: "Failed to list ad sets",
      error: error.message,
    })
  }
}

/**
 * POST /admin/meta-ads/adsets
 * 
 * Create an ad set
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const adSet = await socials.createAdSets(body)

    res.json({ adSet })
  } catch (error: any) {
    console.error("Failed to create ad set:", error)
    res.status(500).json({
      message: "Failed to create ad set",
      error: error.message,
    })
  }
}
