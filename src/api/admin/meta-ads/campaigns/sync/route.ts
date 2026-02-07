/**
 * @file Admin API route for syncing Meta Ads campaigns
 * @description Provides endpoints for synchronizing Meta Ads campaigns, ad sets, and ads with the JYT Commerce platform
 * @module API/Admin/MetaAds/Campaigns
 */

/**
 * @typedef {Object} MetaAdsSyncRequest
 * @property {string} ad_account_id.required - The Meta Ads account ID (either internal ID or meta_account_id like "act_123456")
 * @property {boolean} [include_insights=false] - Whether to fetch campaign insights (default: false)
 */

/**
 * @typedef {Object} MetaAdsSyncResult
 * @property {number} campaigns_created - Number of campaigns created
 * @property {number} campaigns_updated - Number of campaigns updated
 * @property {number} adsets_created - Number of ad sets created
 * @property {number} adsets_updated - Number of ad sets updated
 * @property {number} ads_created - Number of ads created
 * @property {number} ads_updated - Number of ads updated
 * @property {number} errors - Number of errors encountered during sync
 */

/**
 * @typedef {Object} MetaAdsSyncResponse
 * @property {string} message - Summary message of the sync operation
 * @property {Object} results - Detailed sync results
 * @property {number} results.created - Total number of entities created
 * @property {number} results.updated - Total number of entities updated
 * @property {MetaAdsSyncResult} results - Detailed breakdown of sync results
 */

/**
 * Sync Meta Ads campaigns, ad sets, and ads
 * @route POST /admin/meta-ads/campaigns/sync
 * @group Meta Ads - Operations related to Meta Ads integration
 * @param {MetaAdsSyncRequest} request.body.required - Sync parameters
 * @returns {MetaAdsSyncResponse} 200 - Sync operation results
 * @throws {MedusaError} 400 - Missing required parameters or invalid access token
 * @throws {MedusaError} 404 - Ad account or platform not found
 * @throws {MedusaError} 500 - Internal server error during sync
 *
 * @example request
 * POST /admin/meta-ads/campaigns/sync
 * {
 *   "ad_account_id": "act_123456789",
 *   "include_insights": true
 * }
 *
 * @example response 200
 * {
 *   "message": "Synced 5 campaigns, 12 ad sets, 20 ads",
 *   "results": {
 *     "created": 8,
 *     "updated": 29,
 *     "campaigns_created": 2,
 *     "campaigns_updated": 3,
 *     "adsets_created": 3,
 *     "adsets_updated": 9,
 *     "ads_created": 3,
 *     "ads_updated": 17,
 *     "errors": 0
 *   }
 * }
 *
 * @example response 400
 * {
 *   "message": "ad_account_id is required"
 * }
 *
 * @example response 404
 * {
 *   "message": "Ad account not found. Please sync ad accounts first."
 * }
 *
 * @example response 500
 * {
 *   "message": "Failed to sync campaigns",
 *   "error": "Internal server error details"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import MetaAdsService from "../../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../../modules/socials/utils/token-helpers"

/**
 * POST /admin/meta-ads/campaigns/sync
 * 
 * Sync campaigns from Meta for an ad account
 * 
 * Body:
 * - ad_account_id: Internal ad account ID (required)
 * - include_insights: Whether to fetch insights (optional, default false)
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
    const body = req.body as Record<string, any>
    
    const { ad_account_id, include_insights = false } = body

    if (!ad_account_id) {
      return res.status(400).json({
        message: "ad_account_id is required",
      })
    }

    // Get ad account - the frontend sends meta_account_id (e.g., act_123456)
    // We need to look it up by meta_account_id, not internal ID
    let adAccount: any = null
    
    // First try to find by meta_account_id
    const accounts = await socials.listAdAccounts({
      meta_account_id: ad_account_id,
    })
    
    if (accounts.length > 0) {
      adAccount = accounts[0]
    } else {
      // Fallback: try as internal ID
      try {
        adAccount = await socials.retrieveAdAccount(ad_account_id)
      } catch (e) {
        // Not found by internal ID either
      }
    }
    
    if (!adAccount) {
      return res.status(404).json({
        message: `Ad account not found. Please sync ad accounts first.`,
      })
    }

    // Get platform and access token
    const platform = await socials.retrieveSocialPlatform((adAccount as any).platform_id)
    
    if (!platform) {
      return res.status(404).json({
        message: "Platform not found",
      })
    }

    const apiConfig = platform.api_config as any
    const accessToken = decryptAccessToken(apiConfig, req.scope)
    
    if (!accessToken) {
      return res.status(400).json({
        message: "No access token available",
      })
    }

    const metaAds = new MetaAdsService()
    const results = {
      campaigns_created: 0,
      campaigns_updated: 0,
      adsets_created: 0,
      adsets_updated: 0,
      ads_created: 0,
      ads_updated: 0,
      errors: 0,
    }

    // Fetch campaigns from Meta
    const metaCampaigns = await metaAds.listCampaigns(
      (adAccount as any).meta_account_id,
      accessToken
    )

    console.log(`Found ${metaCampaigns.length} campaigns from Meta`)

    for (const metaCampaign of metaCampaigns) {
      try {
        // Check if campaign already exists
        const existingCampaigns = await socials.listAdCampaigns({
          meta_campaign_id: metaCampaign.id,
        })

        // Fetch insights if requested
        let insights: any = null
        if (include_insights) {
          try {
            insights = await metaAds.getInsights(metaCampaign.id, accessToken, {
              date_preset: "last_30d",
            })
          } catch (e) {
            console.warn(`Failed to get insights for campaign ${metaCampaign.id}`)
          }
        }

        const campaignData: Record<string, any> = {
          meta_campaign_id: metaCampaign.id,
          name: metaCampaign.name,
          objective: metaCampaign.objective || "OTHER",
          status: metaCampaign.status || "PAUSED",
          effective_status: metaCampaign.effective_status || null,
          configured_status: metaCampaign.configured_status || null,
          buying_type: metaCampaign.buying_type || "AUCTION",
          daily_budget: metaCampaign.daily_budget ? parseFloat(metaCampaign.daily_budget) / 100 : null,
          lifetime_budget: metaCampaign.lifetime_budget ? parseFloat(metaCampaign.lifetime_budget) / 100 : null,
          budget_remaining: metaCampaign.budget_remaining ? parseFloat(metaCampaign.budget_remaining) / 100 : null,
          special_ad_categories: metaCampaign.special_ad_categories || null,
          start_time: metaCampaign.start_time ? new Date(metaCampaign.start_time) : null,
          stop_time: metaCampaign.stop_time ? new Date(metaCampaign.stop_time) : null,
          last_synced_at: new Date(),
          ad_account_id: adAccount.id, // Use internal ID, not meta_account_id
        }

        // Add insights data if available
        if (insights?.data?.[0]) {
          const insightData = insights.data[0]
          campaignData.impressions = parseInt(insightData.impressions || "0", 10)
          campaignData.clicks = parseInt(insightData.clicks || "0", 10)
          campaignData.spend = parseFloat(insightData.spend || "0")
          campaignData.reach = parseInt(insightData.reach || "0", 10)
          campaignData.cpc = insightData.cpc ? parseFloat(insightData.cpc) : null
          campaignData.cpm = insightData.cpm ? parseFloat(insightData.cpm) : null
          campaignData.ctr = insightData.ctr ? parseFloat(insightData.ctr) : null
          
          // Extract lead count from actions
          campaignData.leads = metaAds.extractLeadCount(insights)
        }

        let internalCampaignId: string
        
        if (existingCampaigns.length > 0) {
          await socials.updateAdCampaigns([{
            selector: { id: existingCampaigns[0].id },
            data: campaignData,
          }])
          internalCampaignId = existingCampaigns[0].id
          results.campaigns_updated++
        } else {
          const created = await socials.createAdCampaigns(campaignData as any)
          internalCampaignId = (created as any).id
          results.campaigns_created++
        }

        // Sync Ad Sets for this campaign
        try {
          const metaAdSets = await metaAds.listAdSets(metaCampaign.id, accessToken)
          console.log(`Found ${metaAdSets.length} ad sets for campaign ${metaCampaign.name}`)
          
          for (const metaAdSet of metaAdSets) {
            try {
              const existingAdSets = await socials.listAdSets({
                meta_adset_id: metaAdSet.id,
              })
              
              const adSetData: Record<string, any> = {
                meta_adset_id: metaAdSet.id,
                name: metaAdSet.name,
                status: metaAdSet.status || "PAUSED",
                effective_status: metaAdSet.effective_status || null,
                daily_budget: metaAdSet.daily_budget ? parseFloat(metaAdSet.daily_budget) / 100 : null,
                lifetime_budget: metaAdSet.lifetime_budget ? parseFloat(metaAdSet.lifetime_budget) / 100 : null,
                bid_amount: metaAdSet.bid_amount ? parseFloat(metaAdSet.bid_amount) / 100 : null,
                billing_event: metaAdSet.billing_event || null,
                optimization_goal: metaAdSet.optimization_goal || null,
                targeting: metaAdSet.targeting || null,
                start_time: metaAdSet.start_time ? new Date(metaAdSet.start_time) : null,
                end_time: metaAdSet.end_time ? new Date(metaAdSet.end_time) : null,
                last_synced_at: new Date(),
                campaign_id: internalCampaignId,
              }
              
              let internalAdSetId: string
              
              if (existingAdSets.length > 0) {
                await socials.updateAdSets([{
                  selector: { id: existingAdSets[0].id },
                  data: adSetData,
                }])
                internalAdSetId = existingAdSets[0].id
                results.adsets_updated++
              } else {
                const createdAdSet = await socials.createAdSets(adSetData as any)
                internalAdSetId = (createdAdSet as any).id
                results.adsets_created++
              }
              
              // Sync Ads for this ad set
              try {
                const metaAdsData = await metaAds.listAds(metaAdSet.id, accessToken)
                console.log(`Found ${metaAdsData.length} ads for ad set ${metaAdSet.name}`)
                
                for (const metaAd of metaAdsData) {
                  try {
                    const existingAds = await socials.listAds({
                      meta_ad_id: metaAd.id,
                    })
                    
                    const adData: Record<string, any> = {
                      meta_ad_id: metaAd.id,
                      name: metaAd.name,
                      status: metaAd.status || "PAUSED",
                      effective_status: metaAd.effective_status || null,
                      creative_id: metaAd.creative?.id || null,
                      preview_url: metaAd.preview_shareable_link || null,
                      last_synced_at: new Date(),
                      ad_set_id: internalAdSetId, // Note: model uses ad_set_id not adset_id
                    }
                    
                    if (existingAds.length > 0) {
                      await socials.updateAds([{
                        selector: { id: existingAds[0].id },
                        data: adData,
                      }])
                      results.ads_updated++
                    } else {
                      await socials.createAds(adData as any)
                      results.ads_created++
                    }
                  } catch (adError) {
                    console.error(`Failed to sync ad ${metaAd.id}:`, adError)
                    results.errors++
                  }
                }
              } catch (adsError) {
                console.error(`Failed to fetch ads for ad set ${metaAdSet.id}:`, adsError)
              }
            } catch (adSetError) {
              console.error(`Failed to sync ad set ${metaAdSet.id}:`, adSetError)
              results.errors++
            }
          }
        } catch (adSetsError) {
          console.error(`Failed to fetch ad sets for campaign ${metaCampaign.id}:`, adSetsError)
        }
      } catch (error) {
        console.error(`Failed to sync campaign ${metaCampaign.id}:`, error)
        results.errors++
      }
    }

    const totalCreated = results.campaigns_created + results.adsets_created + results.ads_created
    const totalUpdated = results.campaigns_updated + results.adsets_updated + results.ads_updated

    res.json({
      message: `Synced ${results.campaigns_created + results.campaigns_updated} campaigns, ${results.adsets_created + results.adsets_updated} ad sets, ${results.ads_created + results.ads_updated} ads`,
      results: {
        created: totalCreated,
        updated: totalUpdated,
        ...results,
      },
    })
  } catch (error: any) {
    console.error("Failed to sync campaigns:", error)
    res.status(500).json({
      message: "Failed to sync campaigns",
      error: error.message,
    })
  }
}
