import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import MetaAdsService from "../../../../modules/social-provider/meta-ads-service"
import { PlatformData, AdAccountData, AggregatedMetrics } from "../types"

export const updateEntityMetricsStepId = "update-entity-metrics"

interface UpdateEntityMetricsInput {
  platform: PlatformData
  adAccount: AdAccountData
}

/**
 * Step 4: Update entity metrics (campaigns, ad sets, ads)
 * 
 * This step fetches lifetime insights and updates the aggregated metrics
 * on campaigns, ad sets, and ads.
 */
export const updateEntityMetricsStep = createStep(
  updateEntityMetricsStepId,
  async (input: UpdateEntityMetricsInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const metaAds = new MetaAdsService()

    const results = {
      campaigns_updated: 0,
      adsets_updated: 0,
      ads_updated: 0,
    }

    // Update campaign metrics
    try {
      const campaignCount = await updateCampaignMetrics(
        socials,
        metaAds,
        input.adAccount.meta_account_id,
        input.platform.accessToken
      )
      results.campaigns_updated = campaignCount
    } catch (error) {
      console.error("[SyncInsights] Failed to update campaign metrics:", error)
    }

    // Update ad set metrics
    try {
      const adsetCount = await updateAdSetMetrics(
        socials,
        metaAds,
        input.adAccount.meta_account_id,
        input.platform.accessToken
      )
      results.adsets_updated = adsetCount
    } catch (error) {
      console.error("[SyncInsights] Failed to update ad set metrics:", error)
    }

    // Update ad metrics
    try {
      const adCount = await updateAdMetrics(
        socials,
        metaAds,
        input.adAccount.meta_account_id,
        input.platform.accessToken
      )
      results.ads_updated = adCount
    } catch (error) {
      console.error("[SyncInsights] Failed to update ad metrics:", error)
    }

    console.log(`[SyncInsights] Updated metrics: ${results.campaigns_updated} campaigns, ${results.adsets_updated} ad sets, ${results.ads_updated} ads`)

    return new StepResponse(results)
  }
)

/**
 * Aggregate insights and update campaign metrics
 */
async function updateCampaignMetrics(
  socials: SocialsService,
  metaAds: MetaAdsService,
  adAccountId: string,
  accessToken: string
): Promise<number> {
  const insightsResponse = await metaAds.getInsights(adAccountId, accessToken, {
    level: "campaign",
    date_preset: "maximum",
    time_increment: 1,
    fields: ["campaign_id", "impressions", "reach", "clicks", "spend", "ctr", "cpc", "cpm", "actions"],
  })

  const insights = (insightsResponse as any).data || []
  console.log(`[SyncInsights] Aggregating ${insights.length} daily campaign insights`)

  // Aggregate by campaign_id
  const aggregates = aggregateByEntityId(insights, "campaign_id")

  let updatedCount = 0
  for (const [metaCampaignId, totals] of Object.entries(aggregates)) {
    const campaigns = await socials.listAdCampaigns({ meta_campaign_id: metaCampaignId })
    const campaign = campaigns[0] as any
    if (!campaign?.id) continue

    const metrics = calculateDerivedMetrics(totals)

    try {
      await socials.updateAdCampaigns([{
        selector: { id: campaign.id },
        data: {
          impressions: totals.impressions,
          reach: totals.reach,
          clicks: totals.clicks,
          spend: totals.spend,
          leads: totals.leads,
          ...metrics,
          last_synced_at: new Date(),
        },
      }])
      updatedCount++
    } catch (e) {
      console.error(`Failed to update campaign ${campaign.id}:`, e)
    }
  }

  return updatedCount
}

/**
 * Aggregate insights and update ad set metrics
 */
async function updateAdSetMetrics(
  socials: SocialsService,
  metaAds: MetaAdsService,
  adAccountId: string,
  accessToken: string
): Promise<number> {
  const insightsResponse = await metaAds.getInsights(adAccountId, accessToken, {
    level: "adset",
    date_preset: "maximum",
    time_increment: 1,
    fields: ["adset_id", "impressions", "reach", "clicks", "spend", "ctr", "cpc", "cpm", "actions"],
  })

  const insights = (insightsResponse as any).data || []
  console.log(`[SyncInsights] Aggregating ${insights.length} daily ad set insights`)

  const aggregates = aggregateByEntityId(insights, "adset_id")

  let updatedCount = 0
  for (const [metaAdsetId, totals] of Object.entries(aggregates)) {
    const adsets = await socials.listAdSets({ meta_adset_id: metaAdsetId })
    const adset = adsets[0] as any
    if (!adset?.id) continue

    const metrics = calculateDerivedMetrics(totals)

    try {
      await socials.updateAdSets([{
        selector: { id: adset.id },
        data: {
          impressions: totals.impressions,
          reach: totals.reach,
          clicks: totals.clicks,
          spend: totals.spend,
          leads: totals.leads,
          ...metrics,
          last_synced_at: new Date(),
        },
      }])
      updatedCount++
    } catch (e) {
      console.error(`Failed to update ad set ${adset.id}:`, e)
    }
  }

  return updatedCount
}

/**
 * Aggregate insights and update ad metrics
 */
async function updateAdMetrics(
  socials: SocialsService,
  metaAds: MetaAdsService,
  adAccountId: string,
  accessToken: string
): Promise<number> {
  const insightsResponse = await metaAds.getInsights(adAccountId, accessToken, {
    level: "ad",
    date_preset: "maximum",
    time_increment: 1,
    fields: ["ad_id", "impressions", "reach", "clicks", "spend", "ctr", "cpc", "cpm", "actions"],
  })

  const insights = (insightsResponse as any).data || []
  console.log(`[SyncInsights] Aggregating ${insights.length} daily ad insights`)

  const aggregates = aggregateByEntityId(insights, "ad_id")

  let updatedCount = 0
  for (const [metaAdId, totals] of Object.entries(aggregates)) {
    const ads = await socials.listAds({ meta_ad_id: metaAdId })
    const ad = ads[0] as any
    if (!ad?.id) continue

    const metrics = calculateDerivedMetrics(totals)

    try {
      await socials.updateAds([{
        selector: { id: ad.id },
        data: {
          impressions: totals.impressions,
          reach: totals.reach,
          clicks: totals.clicks,
          spend: totals.spend,
          leads: totals.leads,
          conversions: totals.conversions || 0,
          ...metrics,
          last_synced_at: new Date(),
        },
      }])
      updatedCount++
    } catch (e) {
      console.error(`Failed to update ad ${ad.id}:`, e)
    }
  }

  return updatedCount
}

/**
 * Aggregate daily insights by entity ID
 */
function aggregateByEntityId(
  insights: any[],
  idField: string
): Record<string, AggregatedMetrics> {
  const aggregates: Record<string, AggregatedMetrics> = {}

  for (const insight of insights) {
    const entityId = insight[idField]
    if (!entityId) continue

    if (!aggregates[entityId]) {
      aggregates[entityId] = {
        impressions: 0,
        reach: 0,
        clicks: 0,
        spend: 0,
        leads: 0,
        conversions: 0,
      }
    }

    aggregates[entityId].impressions += parseInt(insight.impressions || "0") || 0
    aggregates[entityId].reach += parseInt(insight.reach || "0") || 0
    aggregates[entityId].clicks += parseInt(insight.clicks || "0") || 0
    aggregates[entityId].spend += parseFloat(insight.spend || "0") || 0

    // Extract leads from actions
    const actions = insight.actions || []
    const leadAction = actions.find((a: any) => a.action_type === "lead")
    if (leadAction) {
      aggregates[entityId].leads += parseInt(leadAction.value) || 0
    }
  }

  return aggregates
}

/**
 * Calculate derived metrics from totals
 */
function calculateDerivedMetrics(totals: AggregatedMetrics) {
  return {
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null,
    cost_per_lead: totals.leads > 0 ? totals.spend / totals.leads : null,
  }
}
