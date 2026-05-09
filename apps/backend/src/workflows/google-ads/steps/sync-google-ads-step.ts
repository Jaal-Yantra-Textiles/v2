import axios from "axios"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import { withGoogleRetry } from "../../../modules/social-provider/google-retry"

export type SyncGoogleAdsInput = {
  platform_id: string
  /** From the upstream refreshGoogleTokenStep */
  access_token: string
  /** Optional: scope the sync to a single CID; defaults to all `ads` bindings */
  customer_id?: string
}

export type SyncGoogleAdsOutput = {
  platform_id: string
  customers_synced: number
  campaigns_synced: number
  ad_groups_synced: number
  errors: Array<{ customer_id: string; message: string }>
}

const ADS_API_BASE = "https://googleads.googleapis.com/v24"

const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1"

// Aggregate-friendly campaign metrics over a 30d window. Ads' searchStream
// doesn't allow `WHERE segments.date BETWEEN ...` and `LIMIT` together for
// metric queries, so we keep it simple and let the caller filter status.
const CAMPAIGN_QUERY = `
  SELECT
    campaign.id,
    campaign.resource_name,
    campaign.name,
    campaign.status,
    campaign.serving_status,
    campaign.advertising_channel_type,
    campaign.bidding_strategy_type,
    campaign.start_date,
    campaign.end_date,
    campaign_budget.amount_micros,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.cost_micros
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
`.replace(/\s+/g, " ").trim()

const AD_GROUP_QUERY = `
  SELECT
    ad_group.id,
    ad_group.resource_name,
    ad_group.name,
    ad_group.status,
    ad_group.type,
    ad_group.campaign,
    metrics.impressions,
    metrics.clicks,
    metrics.conversions,
    metrics.cost_micros
  FROM ad_group
  WHERE segments.date DURING LAST_30_DAYS
`.replace(/\s+/g, " ").trim()

/**
 * Pull-and-upsert Google Ads data for a SocialPlatform's `ads` bindings.
 *
 * Flow per CID:
 *   1. Hydrate customer fields (descriptive_name, currency, etc.)
 *   2. GAQL searchStream — campaigns with rolled-up 30d metrics
 *   3. GAQL searchStream — ad_groups with rolled-up 30d metrics
 *   4. Upsert (customer → campaigns → ad_groups) — keyed by Google IDs so
 *      re-syncs replace metrics in place rather than appending.
 *
 * Best-effort per CID: a failure on one customer doesn't stop the rest, but
 * the error is recorded on the customer row's `sync_status: "error"`.
 */
export const syncGoogleAdsStep = createStep(
  "sync-google-ads-step",
  async (input: SyncGoogleAdsInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

    const developerToken = await readDeveloperToken(
      input.platform_id,
      socials,
      encryption
    )
    if (!developerToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Google Ads sync requires a developer token on the platform row"
      )
    }

    // Resolve CIDs from bindings (or from explicit input)
    const bindings = await socials.listSocialPlatformBindings({
      platform_id: input.platform_id,
      service: "ads",
    })

    const targets = (
      input.customer_id
        ? bindings.filter((b: any) => b.resource_id === input.customer_id)
        : bindings
    ).map((b: any) => ({
      binding_id: b.id as string,
      customer_id: String(b.resource_id),
      resource_label: (b.resource_label as string) || null,
    }))

    if (targets.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        input.customer_id
          ? `No Google Ads binding for customer_id ${input.customer_id}`
          : "No Google Ads bindings on this platform — bind at least one CID first"
      )
    }

    const headers = {
      Authorization: `Bearer ${input.access_token}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    }

    let customersSynced = 0
    let campaignsSynced = 0
    let adGroupsSynced = 0
    const errors: Array<{ customer_id: string; message: string }> = []

    for (const t of targets) {
      try {
        const { customer, campaigns, adGroups } = await pullCidData(
          t.customer_id,
          headers,
          logger
        )

        const customerRow = await upsertCustomer(socials, {
          platform_id: input.platform_id,
          binding_id: t.binding_id,
          customer_id: t.customer_id,
          resource_name: customer.resource_name,
          descriptive_name: customer.descriptive_name || t.resource_label,
          currency_code: customer.currency_code,
          time_zone: customer.time_zone,
          is_manager: !!customer.manager,
          is_test_account: !!customer.test_account,
        })
        customersSynced += 1

        const campaignRowsByCampaignId = await upsertCampaigns(
          socials,
          customerRow.id,
          campaigns
        )
        campaignsSynced += campaigns.length

        const adGroupCount = await upsertAdGroups(
          socials,
          campaignRowsByCampaignId,
          adGroups
        )
        adGroupsSynced += adGroupCount
      } catch (e: any) {
        const msg = e.response?.data?.error?.message || e.message
        logger?.warn?.(
          `[google-ads] sync failed for cid=${t.customer_id}: ${msg}`
        )
        errors.push({ customer_id: t.customer_id, message: msg })

        // Mark the customer row (if it exists) as errored so the operator
        // can see the last failure inline.
        try {
          await markCustomerError(socials, input.platform_id, t.customer_id, msg)
        } catch {
          // ignore — the customer may not exist yet on first failed sync
        }
      }
    }

    return new StepResponse<SyncGoogleAdsOutput>({
      platform_id: input.platform_id,
      customers_synced: customersSynced,
      campaigns_synced: campaignsSynced,
      ad_groups_synced: adGroupsSynced,
      errors,
    })
  }
)

async function pullCidData(
  cid: string,
  headers: Record<string, string>,
  logger?: Logger
) {
  const customerRes = await withGoogleRetry(
    () =>
      axios.post(
        `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
        { query: CUSTOMER_QUERY },
        { headers }
      ),
    { label: `ads.customer(${cid})`, logger, maxAttempts: 3 }
  )
  const customerRow =
    extractFirstRow(customerRes.data)?.customer ?? {}

  const campaignsRes = await withGoogleRetry(
    () =>
      axios.post(
        `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
        { query: CAMPAIGN_QUERY },
        { headers }
      ),
    { label: `ads.campaigns(${cid})`, logger, maxAttempts: 3 }
  )
  const campaigns = extractAllRows(campaignsRes.data)

  const adGroupsRes = await withGoogleRetry(
    () =>
      axios.post(
        `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
        { query: AD_GROUP_QUERY },
        { headers }
      ),
    { label: `ads.adGroups(${cid})`, logger, maxAttempts: 3 }
  )
  const adGroups = extractAllRows(adGroupsRes.data)

  return {
    customer: {
      resource_name: `customers/${cid}`,
      descriptive_name: customerRow.descriptiveName ?? null,
      currency_code: customerRow.currencyCode ?? null,
      time_zone: customerRow.timeZone ?? null,
      manager: customerRow.manager ?? false,
      test_account: customerRow.testAccount ?? false,
    },
    campaigns,
    adGroups,
  }
}

// Google's searchStream returns either an array of chunks each with `results`
// or a single object with `results`. Normalize.
function extractAllRows(data: any): any[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.flatMap((chunk) => chunk?.results || [])
  }
  return data.results || []
}

function extractFirstRow(data: any): any {
  return extractAllRows(data)[0] ?? null
}

async function upsertCustomer(
  socials: any,
  data: {
    platform_id: string
    binding_id: string
    customer_id: string
    resource_name: string
    descriptive_name: string | null
    currency_code: string | null
    time_zone: string | null
    is_manager: boolean
    is_test_account: boolean
  }
) {
  const [existing] = await socials.listGoogleAdsCustomers(
    { platform_id: data.platform_id, customer_id: data.customer_id },
    { take: 1 }
  )
  const now = new Date()
  if (existing) {
    const [updated] = await socials.updateGoogleAdsCustomers([
      {
        selector: { id: existing.id },
        data: {
          ...data,
          last_synced_at: now,
          sync_status: "synced",
          sync_error: null,
        },
      },
    ])
    return updated
  }
  const [created] = await socials.createGoogleAdsCustomers([
    {
      ...data,
      last_synced_at: now,
      sync_status: "synced",
    },
  ])
  return created
}

async function markCustomerError(
  socials: any,
  platform_id: string,
  customer_id: string,
  message: string
) {
  const [existing] = await socials.listGoogleAdsCustomers(
    { platform_id, customer_id },
    { take: 1 }
  )
  if (!existing) return
  await socials.updateGoogleAdsCustomers([
    {
      selector: { id: existing.id },
      data: { sync_status: "error", sync_error: message.slice(0, 1000) },
    },
  ])
}

async function upsertCampaigns(
  socials: any,
  customer_pk: string,
  rows: any[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>() // googleCampaignId → campaign row id
  if (rows.length === 0) return out

  const ids = rows
    .map((r) => String(r.campaign?.id ?? ""))
    .filter(Boolean)
  const existing = await socials.listGoogleAdsCampaigns(
    { customer_id: customer_pk, campaign_id: ids }
  )
  const byCampaignId = new Map<string, any>(
    existing.map((e: any) => [e.campaign_id, e])
  )

  const now = new Date()
  for (const row of rows) {
    const cmp = row.campaign || {}
    const budget = row.campaignBudget || row.campaign_budget || {}
    const metrics = row.metrics || {}
    const cid = String(cmp.id ?? "")
    if (!cid) continue

    const data = {
      campaign_id: cid,
      resource_name: cmp.resourceName ?? cmp.resource_name ?? null,
      name: cmp.name || cid,
      status: (cmp.status as any) || "UNSPECIFIED",
      serving_status: cmp.servingStatus ?? cmp.serving_status ?? null,
      advertising_channel_type:
        (cmp.advertisingChannelType ?? cmp.advertising_channel_type) ||
        "UNSPECIFIED",
      bidding_strategy_type:
        cmp.biddingStrategyType ?? cmp.bidding_strategy_type ?? null,
      start_date: cmp.startDate ?? cmp.start_date ?? null,
      end_date: cmp.endDate ?? cmp.end_date ?? null,
      budget_amount_micros: budget.amountMicros ?? budget.amount_micros ?? null,
      impressions: metrics.impressions ?? 0,
      clicks: metrics.clicks ?? 0,
      conversions: metrics.conversions ?? 0,
      cost_micros: metrics.costMicros ?? metrics.cost_micros ?? 0,
      last_synced_at: now,
    }

    const found = byCampaignId.get(cid)
    if (found) {
      await socials.updateGoogleAdsCampaigns([
        { selector: { id: found.id }, data },
      ])
      out.set(cid, found.id)
    } else {
      const [created] = await socials.createGoogleAdsCampaigns([
        { ...data, customer_id: customer_pk },
      ])
      out.set(cid, created.id)
    }
  }

  return out
}

async function upsertAdGroups(
  socials: any,
  campaignRowsByCampaignId: Map<string, string>,
  rows: any[]
): Promise<number> {
  if (rows.length === 0) return 0

  // Map ad_group's parent campaign resource (`customers/X/campaigns/Y`) → our
  // GoogleAdsCampaign row id.
  let synced = 0
  const now = new Date()

  // Pre-fetch existing ad groups across the synced campaigns so we don't
  // pound the DB with lookups in a hot loop.
  const campaignRowIds = [...campaignRowsByCampaignId.values()]
  const existing = campaignRowIds.length
    ? await socials.listGoogleAdsAdGroups({ campaign_id: campaignRowIds })
    : []
  const byKey = new Map<string, any>()
  for (const e of existing) {
    byKey.set(`${e.campaign_id}:${e.ad_group_id}`, e)
  }

  for (const row of rows) {
    const ag = row.adGroup || row.ad_group || {}
    const metrics = row.metrics || {}
    const adGroupId = String(ag.id ?? "")
    const campaignResource: string | undefined =
      ag.campaign || ag.campaign_resource_name || ag.campaignResource

    // Parent campaign ID is "customers/X/campaigns/Y" — pull the trailing
    // segment to match against our `campaign_id` keys.
    const parentCampaignId = campaignResource
      ? campaignResource.split("/").pop() ?? ""
      : ""
    const parentRowId = campaignRowsByCampaignId.get(parentCampaignId)
    if (!adGroupId || !parentRowId) continue

    const data = {
      ad_group_id: adGroupId,
      resource_name: ag.resourceName ?? ag.resource_name ?? null,
      name: ag.name || adGroupId,
      status: (ag.status as any) || "UNSPECIFIED",
      type: ag.type ?? null,
      impressions: metrics.impressions ?? 0,
      clicks: metrics.clicks ?? 0,
      conversions: metrics.conversions ?? 0,
      cost_micros: metrics.costMicros ?? metrics.cost_micros ?? 0,
      last_synced_at: now,
    }

    const found = byKey.get(`${parentRowId}:${adGroupId}`)
    if (found) {
      await socials.updateGoogleAdsAdGroups([
        { selector: { id: found.id }, data },
      ])
    } else {
      await socials.createGoogleAdsAdGroups([
        { ...data, campaign_id: parentRowId },
      ])
    }
    synced += 1
  }

  return synced
}

async function readDeveloperToken(
  platform_id: string,
  socials: any,
  encryption: EncryptionService
): Promise<string | null> {
  const [platform] = await socials.listSocialPlatforms(
    { id: platform_id },
    { take: 1 }
  )
  if (!platform) return null
  const apiConfig = (platform.api_config || {}) as Record<string, any>
  if (!apiConfig.developer_token_encrypted) return null
  try {
    return encryption.decrypt(apiConfig.developer_token_encrypted)
  } catch {
    return null
  }
}
