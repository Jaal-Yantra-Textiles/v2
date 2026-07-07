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
  /** Pull ad-level rows (ad_group_ad) and write to GoogleAdsAd. Default true. */
  include_ads?: boolean
  /** Pull daily time-series and write to GoogleAdsInsights. Default true. */
  include_insights?: boolean
  /** Also pull device-breakdown insights at campaign + ad_group. Default false. */
  include_breakdowns?: boolean
  /**
   * Lookback window in days for aggregates + daily insights. Default 30, max
   * ~10y. Ignored when `start_date` is given. Implemented as `segments.date
   * BETWEEN` (NOT the `LAST_N_DAYS` literal, which only allows 7/14/30).
   */
  window_days?: number
  /** Explicit range start (YYYY-MM-DD). Overrides window_days — use for full backfill. */
  start_date?: string
  /** Explicit range end (YYYY-MM-DD). Defaults to today. */
  end_date?: string
}

export type SyncGoogleAdsOutput = {
  platform_id: string
  customers_synced: number
  campaigns_synced: number
  ad_groups_synced: number
  ads_synced: number
  insights_rows_synced: number
  errors: Array<{ customer_id: string; message: string }>
}

const ADS_API_BASE = "https://googleads.googleapis.com/v24"

const CUSTOMER_QUERY =
  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1"

// Enriched aggregate metrics for the rolled-up rows on campaign / ad_group / ad.
// Date-scoped via an explicit `segments.date BETWEEN 'start' AND 'end'` clause
// (see resolveSyncDateRange) so any lookback works — the `LAST_N_DAYS` literal
// these once used only accepts 7/14/30.
export const AGGREGATE_METRICS_FIELDS = [
  "metrics.impressions",
  "metrics.clicks",
  "metrics.ctr",
  "metrics.average_cpc",
  "metrics.average_cpm",
  // v24 renamed the video CPV/view metrics to the TrueView-namespaced fields;
  // the old metrics.average_cpv / video_views / video_view_rate now 400 with
  // queryError:UNRECOGNIZED_FIELD. DB columns keep their old names — only the
  // GAQL selectors and the response keys read in the mappers change.
  "metrics.trueview_average_cpv",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.all_conversions",
  "metrics.all_conversions_value",
  "metrics.view_through_conversions",
  "metrics.video_trueview_views",
  "metrics.video_trueview_view_rate",
  "metrics.engagements",
  "metrics.engagement_rate",
  "metrics.interactions",
  "metrics.interaction_rate",
]

// Optional video quartile rates — not all account types return these, so we
// keep them in the daily insights query rather than the aggregate (cheaper
// retry on partial-success).
const VIDEO_QUARTILE_FIELDS = [
  "metrics.video_quartile_p25_rate",
  "metrics.video_quartile_p50_rate",
  "metrics.video_quartile_p75_rate",
  "metrics.video_quartile_p100_rate",
]

// GAQL's `LAST_N_DAYS` literal only accepts 7 / 14 / 30 — anything else 400s.
// To support arbitrary lookbacks (incl. a full historical backfill) we build an
// explicit `segments.date BETWEEN 'start' AND 'end'` clause. ~10y cap keeps a
// stray window_days from producing an unbounded query; Google returns only the
// dates it actually retains within the range.
const MAX_WINDOW_DAYS = 3650

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// Only accept well-formed YYYY-MM-DD — these values are interpolated straight
// into GAQL, so an unvalidated string would be an injection vector.
function safeISODate(v: string | undefined | null): string | undefined {
  return typeof v === "string" && ISO_DATE.test(v) ? v : undefined
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function resolveSyncDateRange(
  input: { window_days?: number; start_date?: string; end_date?: string },
  now: Date = new Date()
): { start: string; end: string } {
  const end = safeISODate(input.end_date) ?? toISODate(now)
  const explicitStart = safeISODate(input.start_date)
  if (explicitStart) {
    return { start: explicitStart, end }
  }
  const days = Math.min(Math.max(input.window_days ?? 30, 1), MAX_WINDOW_DAYS)
  const startDate = new Date(now)
  startDate.setUTCDate(startDate.getUTCDate() - days)
  return { start: toISODate(startDate), end }
}

export function buildDateClause(range: { start: string; end: string }): string {
  return `segments.date BETWEEN '${range.start}' AND '${range.end}'`
}

export function buildCampaignAggregateQuery(dateClause: string): string {
  return `
    SELECT
      campaign.id,
      campaign.resource_name,
      campaign.name,
      campaign.status,
      campaign.serving_status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign_budget.amount_micros,
      ${AGGREGATE_METRICS_FIELDS.join(",\n      ")}
    FROM campaign
    WHERE ${dateClause}
  `.replace(/\s+/g, " ").trim()
}

// campaign.start_date / end_date are resource attributes that are NOT selectable
// together with segments.date (the metric/date-segmented query above 400s with
// UNRECOGNIZED_FIELD). Pull them in a separate metric-free query and merge onto
// the aggregate rows by campaign id.
export const CAMPAIGN_DATES_QUERY =
  "SELECT campaign.id, campaign.start_date, campaign.end_date FROM campaign"

function buildAdGroupAggregateQuery(dateClause: string): string {
  return `
    SELECT
      ad_group.id,
      ad_group.resource_name,
      ad_group.name,
      ad_group.status,
      ad_group.type,
      ad_group.campaign,
      ${AGGREGATE_METRICS_FIELDS.join(",\n      ")}
    FROM ad_group
    WHERE ${dateClause}
  `.replace(/\s+/g, " ").trim()
}

// ad_group_ad rolls the placement (status, resource_name) and the creative
// (ad_group_ad.ad.*) together. We flatten the most-useful creative fields per
// ad type — RSAs use the asset arrays, image/video ads use the static fields.
function buildAdAggregateQuery(dateClause: string): string {
  return `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.resource_name,
      ad_group_ad.resource_name,
      ad_group_ad.ad.name,
      ad_group_ad.status,
      ad_group_ad.ad.type,
      ad_group_ad.ad.display_url,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.final_mobile_urls,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_display_ad.headlines,
      ad_group_ad.ad.responsive_display_ad.descriptions,
      ad_group_ad.ad.image_ad.image_url,
      ad_group_ad.ad.video_ad.video.video_id,
      ad_group_ad.ad_group,
      ${AGGREGATE_METRICS_FIELDS.join(",\n      ")}
    FROM ad_group_ad
    WHERE ${dateClause}
  `.replace(/\s+/g, " ").trim()
}

// Daily insights — adds `segments.date` so each row is a per-day snapshot.
// Video quartiles included here; if the account doesn't return them, GAQL
// just omits the fields rather than failing the whole query.
export function buildDailyInsightsQuery(
  level: "campaign" | "ad_group" | "ad",
  dateClause: string,
  breakdown?: "device" | "network"
): string {
  const entityFields =
    level === "campaign"
      ? ["campaign.id", "campaign.resource_name"]
      : level === "ad_group"
        ? ["ad_group.id", "ad_group.resource_name", "ad_group.campaign"]
        : [
            "ad_group_ad.ad.id",
            "ad_group_ad.resource_name",
            "ad_group_ad.ad_group",
          ]
  const breakdownFields: string[] = []
  if (breakdown === "device") breakdownFields.push("segments.device")
  if (breakdown === "network")
    breakdownFields.push("segments.ad_network_type")

  const from =
    level === "campaign"
      ? "campaign"
      : level === "ad_group"
        ? "ad_group"
        : "ad_group_ad"

  return `
    SELECT
      ${entityFields.join(",\n      ")},
      segments.date,
      ${breakdownFields.length ? breakdownFields.join(",\n      ") + "," : ""}
      ${AGGREGATE_METRICS_FIELDS.join(",\n      ")},
      ${VIDEO_QUARTILE_FIELDS.join(",\n      ")},
      metrics.cost_per_conversion
    FROM ${from}
    WHERE ${dateClause}
  `.replace(/\s+/g, " ").trim()
}

/**
 * Pull-and-upsert Google Ads data for a SocialPlatform's `ads` bindings.
 *
 * Flow per CID:
 *   1. customer — descriptive_name, currency, timezone, MCC flags
 *   2. campaigns aggregate + ad_groups aggregate (rolled-up window metrics)
 *   3. ads aggregate (when include_ads — creative + metrics per ad_group_ad)
 *   4. daily insights — campaign + ad_group [+ ad] time-series rows
 *   5. device-breakdown insights (when include_breakdowns)
 *
 * Each (level, entity_id, date, device, network) insights row is keyed
 * uniquely so re-syncs UPDATE in place rather than appending duplicates.
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

    const includeAds = input.include_ads !== false
    const includeInsights = input.include_insights !== false
    const includeBreakdowns = input.include_breakdowns === true
    const dateRange = resolveSyncDateRange(input)
    const dateClause = buildDateClause(dateRange)
    logger?.info?.(
      `[google-ads] sync window ${dateRange.start} → ${dateRange.end} for platform=${input.platform_id}`
    )

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

    const bindings = await socials.listSocialPlatformBindings({
      platform_id: input.platform_id,
      service: "ads",
    })

    const envLoginCid = normalizeCid(
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
    )

    const targets = (
      input.customer_id
        ? bindings.filter((b: any) => b.resource_id === input.customer_id)
        : bindings
    ).map((b: any) => ({
      binding_id: b.id as string,
      customer_id: String(b.resource_id),
      resource_label: (b.resource_label as string) || null,
      // login-customer-id precedence: per-binding settings > per-binding
      // metadata (auto-discovered from manager hierarchy) > workspace env.
      login_customer_id:
        normalizeCid(b.settings?.login_customer_id) ||
        normalizeCid(b.metadata?.login_customer_id) ||
        envLoginCid ||
        null,
    }))

    if (targets.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        input.customer_id
          ? `No Google Ads binding for customer_id ${input.customer_id}`
          : "No Google Ads bindings on this platform — bind at least one CID first"
      )
    }

    const baseHeaders = {
      Authorization: `Bearer ${input.access_token}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    }

    let customersSynced = 0
    let campaignsSynced = 0
    let adGroupsSynced = 0
    let adsSynced = 0
    let insightsRowsSynced = 0
    const errors: Array<{ customer_id: string; message: string }> = []

    for (const t of targets) {
      const headers: Record<string, string> = { ...baseHeaders }
      if (t.login_customer_id) {
        headers["login-customer-id"] = t.login_customer_id
      }
      try {
        const pulled = await pullCidData(
          t.customer_id,
          headers,
          logger,
          { includeAds, includeInsights, includeBreakdowns, dateClause }
        )

        const customerRow = await upsertCustomer(socials, {
          platform_id: input.platform_id,
          binding_id: t.binding_id,
          customer_id: t.customer_id,
          resource_name: pulled.customer.resource_name,
          descriptive_name:
            pulled.customer.descriptive_name || t.resource_label,
          currency_code: pulled.customer.currency_code,
          time_zone: pulled.customer.time_zone,
          is_manager: !!pulled.customer.manager,
          is_test_account: !!pulled.customer.test_account,
        })
        customersSynced += 1

        const campaignRowsByCampaignId = await upsertCampaigns(
          socials,
          customerRow.id,
          pulled.campaigns
        )
        campaignsSynced += pulled.campaigns.length

        const adGroupRowsByAdGroupId = await upsertAdGroups(
          socials,
          campaignRowsByCampaignId,
          pulled.adGroups
        )
        adGroupsSynced += adGroupRowsByAdGroupId.size

        let adRowsByAdId: Map<string, string> = new Map()
        if (includeAds) {
          adRowsByAdId = await upsertAds(
            socials,
            adGroupRowsByAdGroupId,
            pulled.ads
          )
          adsSynced += adRowsByAdId.size
        }

        if (includeInsights) {
          const currency = pulled.customer.currency_code ?? null
          insightsRowsSynced += await upsertInsights(socials, {
            level: "campaign",
            rows: pulled.insights.campaign,
            entityMap: campaignRowsByCampaignId,
            customerRowId: customerRow.id,
            currency,
          })
          insightsRowsSynced += await upsertInsights(socials, {
            level: "ad_group",
            rows: pulled.insights.ad_group,
            entityMap: adGroupRowsByAdGroupId,
            customerRowId: customerRow.id,
            currency,
          })
          if (includeBreakdowns) {
            insightsRowsSynced += await upsertInsights(socials, {
              level: "campaign",
              rows: pulled.insights.campaign_by_device,
              entityMap: campaignRowsByCampaignId,
              customerRowId: customerRow.id,
              currency,
              breakdown: "device",
            })
            insightsRowsSynced += await upsertInsights(socials, {
              level: "ad_group",
              rows: pulled.insights.ad_group_by_device,
              entityMap: adGroupRowsByAdGroupId,
              customerRowId: customerRow.id,
              currency,
              breakdown: "device",
            })
          }

          // Rollup columns on campaign/ad_group/ad are DERIVED from the full
          // stored daily-insights history, not the current window's aggregate —
          // otherwise a routine short-window sync would collapse a paused
          // entity's historical totals to ~0. Insights are append-only, so this
          // sums every base daily row we have on record.
          await recomputeRollupsFromInsights(
            socials,
            "campaign",
            [...campaignRowsByCampaignId.values()]
          )
          await recomputeRollupsFromInsights(
            socials,
            "ad_group",
            [...adGroupRowsByAdGroupId.values()]
          )
          if (includeAds) {
            await recomputeRollupsFromInsights(
              socials,
              "ad",
              [...adRowsByAdId.values()]
            )
          }
        }
      } catch (e: any) {
        const msg = formatGoogleAdsError(e, { hasLoginCid: !!t.login_customer_id })
        logger?.warn?.(
          `[google-ads] sync failed for cid=${t.customer_id}: ${msg}`
        )
        errors.push({ customer_id: t.customer_id, message: msg })

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
      ads_synced: adsSynced,
      insights_rows_synced: insightsRowsSynced,
      errors,
    })
  }
)

type PullOpts = {
  includeAds: boolean
  includeInsights: boolean
  includeBreakdowns: boolean
  /** Pre-built `segments.date BETWEEN …` clause shared by every metric query. */
  dateClause: string
}

async function pullCidData(
  cid: string,
  headers: Record<string, string>,
  logger: Logger | undefined,
  opts: PullOpts
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
  const customerRow = extractFirstRow(customerRes.data)?.customer ?? {}

  // Manager (MCC) accounts have NO campaigns/metrics — every metric query against
  // one returns 400 (QueryError.REQUESTED_METRICS_FOR_MANAGER). Detect it from the
  // (metric-free) customer query and skip the metric pulls entirely, so binding an
  // MCC records the account cleanly instead of 400-looping. Bind a child client
  // CID to get campaign data.
  const isManager = customerRow.manager === true || customerRow.manager === "true"
  if (isManager) {
    logger?.info?.(
      `[google-ads] cid=${cid} is a manager (MCC) account — skipping campaign/metric pulls (managers have no metrics; bind a child CID for campaign data)`
    )
    return {
      customer: {
        resource_name: `customers/${cid}`,
        descriptive_name: customerRow.descriptiveName ?? null,
        currency_code: customerRow.currencyCode ?? null,
        time_zone: customerRow.timeZone ?? null,
        manager: true,
        test_account: customerRow.testAccount ?? false,
      },
      campaigns: [],
      adGroups: [],
      ads: [],
      insights: {
        campaign: [],
        ad_group: [],
        campaign_by_device: [],
        ad_group_by_device: [],
      },
    }
  }

  const campaignsRes = await withGoogleRetry(
    () =>
      axios.post(
        `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
        { query: buildCampaignAggregateQuery(opts.dateClause) },
        { headers }
      ),
    { label: `ads.campaigns(${cid})`, logger, maxAttempts: 3 }
  )
  const campaigns = extractAllRows(campaignsRes.data)

  // Merge campaign start/end dates (fetched metric-free — see CAMPAIGN_DATES_QUERY).
  try {
    const datesRes = await withGoogleRetry(
      () =>
        axios.post(
          `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
          { query: CAMPAIGN_DATES_QUERY },
          { headers }
        ),
      { label: `ads.campaignDates(${cid})`, logger, maxAttempts: 3 }
    )
    const datesById = new Map<string, any>()
    for (const row of extractAllRows(datesRes.data)) {
      const id = String(row.campaign?.id ?? "")
      if (id) datesById.set(id, row.campaign)
    }
    for (const row of campaigns) {
      const dates = datesById.get(String(row.campaign?.id ?? ""))
      if (dates && row.campaign) {
        row.campaign.startDate = dates.startDate ?? dates.start_date ?? null
        row.campaign.endDate = dates.endDate ?? dates.end_date ?? null
      }
    }
  } catch (e: any) {
    // Non-fatal — dates are nice-to-have; keep the metrics we already pulled.
    logger?.warn?.(
      `[google-ads] campaign dates pull failed for cid=${cid}: ${
        e.response?.data?.error?.message || e.message
      }`
    )
  }

  const adGroupsRes = await withGoogleRetry(
    () =>
      axios.post(
        `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
        { query: buildAdGroupAggregateQuery(opts.dateClause) },
        { headers }
      ),
    { label: `ads.adGroups(${cid})`, logger, maxAttempts: 3 }
  )
  const adGroups = extractAllRows(adGroupsRes.data)

  let ads: any[] = []
  if (opts.includeAds) {
    try {
      const adsRes = await withGoogleRetry(
        () =>
          axios.post(
            `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
            { query: buildAdAggregateQuery(opts.dateClause) },
            { headers }
          ),
        { label: `ads.ads(${cid})`, logger, maxAttempts: 3 }
      )
      ads = extractAllRows(adsRes.data)
    } catch (e: any) {
      // Don't fail the whole sync over creative pull — log + continue.
      logger?.warn?.(
        `[google-ads] ad_group_ad pull failed for cid=${cid}: ${googleErrorMessage(e)}`
      )
    }
  }

  const insights = {
    campaign: [] as any[],
    ad_group: [] as any[],
    campaign_by_device: [] as any[],
    ad_group_by_device: [] as any[],
  }
  if (opts.includeInsights) {
    insights.campaign = await pullDailyInsights(
      cid,
      headers,
      logger,
      "campaign",
      opts.dateClause
    )
    insights.ad_group = await pullDailyInsights(
      cid,
      headers,
      logger,
      "ad_group",
      opts.dateClause
    )
    if (opts.includeBreakdowns) {
      insights.campaign_by_device = await pullDailyInsights(
        cid,
        headers,
        logger,
        "campaign",
        opts.dateClause,
        "device"
      )
      insights.ad_group_by_device = await pullDailyInsights(
        cid,
        headers,
        logger,
        "ad_group",
        opts.dateClause,
        "device"
      )
    }
  }

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
    ads,
    insights,
  }
}

async function pullDailyInsights(
  cid: string,
  headers: Record<string, string>,
  logger: Logger | undefined,
  level: "campaign" | "ad_group" | "ad",
  dateClause: string,
  breakdown?: "device" | "network"
): Promise<any[]> {
  try {
    const res = await withGoogleRetry(
      () =>
        axios.post(
          `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`,
          { query: buildDailyInsightsQuery(level, dateClause, breakdown) },
          { headers }
        ),
      { label: `ads.insights.${level}${breakdown ? "." + breakdown : ""}(${cid})`, logger, maxAttempts: 3 }
    )
    return extractAllRows(res.data)
  } catch (e: any) {
    logger?.warn?.(
      `[google-ads] daily insights pull failed for cid=${cid} level=${level}${
        breakdown ? " breakdown=" + breakdown : ""
      }: ${googleErrorMessage(e)}`
    )
    return []
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

/**
 * Unwrap a Google Ads error body to the `{ error: { message, details } }` object.
 * `googleAds:searchStream` returns its ERROR body as an ARRAY (`[{ error: … }]`),
 * not the plain object the unary endpoints return — so `data.error` is undefined
 * for exactly the streaming calls this step makes, and every 400/403 reason gets
 * silently dropped. Handle both shapes.
 */
export function googleErrorRoot(raw: any): any {
  if (Array.isArray(raw)) return raw.find((c: any) => c?.error) ?? raw[0] ?? null
  return raw ?? null
}

/** Best-effort human message from a Google Ads axios error (array-shape aware). */
function googleErrorMessage(e: any): string {
  const root = googleErrorRoot(e?.response?.data)
  return root?.error?.message || e?.message || "Unknown Google Ads error"
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
      impressions: numericMetric(metrics.impressions),
      clicks: numericMetric(metrics.clicks),
      conversions: numericMetric(metrics.conversions),
      cost_micros: numericMetric(
        metrics.costMicros ?? metrics.cost_micros
      ),
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
): Promise<Map<string, string>> {
  const out = new Map<string, string>() // ad_group_id → row id
  if (rows.length === 0) return out

  const now = new Date()
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
      impressions: numericMetric(metrics.impressions),
      clicks: numericMetric(metrics.clicks),
      conversions: numericMetric(metrics.conversions),
      cost_micros: numericMetric(metrics.costMicros ?? metrics.cost_micros),
      last_synced_at: now,
    }

    const found = byKey.get(`${parentRowId}:${adGroupId}`)
    let rowId: string
    if (found) {
      await socials.updateGoogleAdsAdGroups([
        { selector: { id: found.id }, data },
      ])
      rowId = found.id
    } else {
      const [created] = await socials.createGoogleAdsAdGroups([
        { ...data, campaign_id: parentRowId },
      ])
      rowId = created.id
    }
    out.set(adGroupId, rowId)
  }

  return out
}

async function upsertAds(
  socials: any,
  adGroupRowsByAdGroupId: Map<string, string>,
  rows: any[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>() // ad_id → row id
  if (rows.length === 0) return out

  const now = new Date()
  const adGroupRowIds = [...adGroupRowsByAdGroupId.values()]
  const existing = adGroupRowIds.length
    ? await socials.listGoogleAdsAds({ ad_group_id: adGroupRowIds })
    : []
  const byKey = new Map<string, any>()
  for (const e of existing) {
    byKey.set(`${e.ad_group_id}:${e.ad_id}`, e)
  }

  for (const row of rows) {
    const agAd = row.adGroupAd || row.ad_group_ad || {}
    const ad = agAd.ad || {}
    const metrics = row.metrics || {}

    const adId = String(ad.id ?? "")
    const parentAdGroupResource: string | undefined =
      agAd.adGroup || agAd.ad_group
    const parentAdGroupId = parentAdGroupResource
      ? parentAdGroupResource.split("/").pop() ?? ""
      : ""
    const parentRowId = adGroupRowsByAdGroupId.get(parentAdGroupId)
    if (!adId || !parentRowId) continue

    // Headlines/descriptions live under whichever creative variant the ad
    // belongs to. RSAs ≠ RDAs ≠ Image/Video — pick the populated branch.
    const rsa = ad.responsiveSearchAd || ad.responsive_search_ad || {}
    const rda = ad.responsiveDisplayAd || ad.responsive_display_ad || {}
    const headlines = rsa.headlines || rda.headlines || null
    const descriptions = rsa.descriptions || rda.descriptions || null

    const imageAd = ad.imageAd || ad.image_ad || {}
    const videoAd = ad.videoAd || ad.video_ad || {}

    const data = {
      ad_id: adId,
      resource_name: agAd.resourceName ?? agAd.resource_name ?? null,
      ad_resource_name: ad.resourceName ?? ad.resource_name ?? null,
      name: ad.name ?? null,
      status: (agAd.status as any) || "UNSPECIFIED",
      ad_status: (ad.status as any) || "UNSPECIFIED",
      type: ad.type ?? null,
      display_url: ad.displayUrl ?? ad.display_url ?? null,
      final_urls: ad.finalUrls ?? ad.final_urls ?? null,
      final_mobile_urls: ad.finalMobileUrls ?? ad.final_mobile_urls ?? null,
      headlines,
      descriptions,
      image_url: imageAd.imageUrl ?? imageAd.image_url ?? null,
      video_id: videoAd?.video?.videoId ?? videoAd?.video?.video_id ?? null,
      impressions: numericMetric(metrics.impressions),
      clicks: numericMetric(metrics.clicks),
      conversions: numericMetric(metrics.conversions),
      cost_micros: numericMetric(metrics.costMicros ?? metrics.cost_micros),
      last_synced_at: now,
    }

    const found = byKey.get(`${parentRowId}:${adId}`)
    let rowId: string
    if (found) {
      await socials.updateGoogleAdsAds([
        { selector: { id: found.id }, data },
      ])
      rowId = found.id
    } else {
      const [created] = await socials.createGoogleAdsAds([
        { ...data, ad_group_id: parentRowId },
      ])
      rowId = created.id
    }
    out.set(adId, rowId)
  }

  return out
}

type UpsertInsightsArgs = {
  level: "customer" | "campaign" | "ad_group" | "ad"
  rows: any[]
  entityMap: Map<string, string> // google entity_id → row id
  customerRowId: string
  currency: string | null
  breakdown?: "device" | "network"
}

async function upsertInsights(
  socials: any,
  args: UpsertInsightsArgs
): Promise<number> {
  const { rows, entityMap, customerRowId, level, currency, breakdown } = args
  if (rows.length === 0) return 0

  const now = new Date()

  // Pre-fetch existing rows for this batch of entity row ids so we can
  // do a single SELECT and then update/create in a tight loop.
  const entityRowIds = [...entityMap.values()]
  const filters: Record<string, any> = { level }
  if (level === "campaign") filters.campaign_id = entityRowIds
  if (level === "ad_group") filters.ad_group_id = entityRowIds
  if (level === "ad") filters.ad_id = entityRowIds
  if (level === "customer") filters.customer_id = customerRowId

  const existing = entityRowIds.length || level === "customer"
    ? await socials.listGoogleAdsInsights(filters)
    : []

  // Composite key. Nulls become "_" so 'no device' and device='_' don't
  // collide.
  const buildKey = (e: any) =>
    [
      e.level,
      e.customer_id ?? "_",
      e.campaign_id ?? "_",
      e.ad_group_id ?? "_",
      e.ad_id ?? "_",
      e.date,
      e.device ?? "_",
      e.network ?? "_",
      e.geo_country_code ?? "_",
      e.geo_region ?? "_",
    ].join("|")

  const byKey = new Map<string, any>(existing.map((e: any) => [buildKey(e), e]))

  let synced = 0
  for (const row of rows) {
    const segments = row.segments || {}
    const metrics = row.metrics || {}
    const date = segments.date as string | undefined
    if (!date) continue

    const entityGoogleId =
      level === "campaign"
        ? String(row.campaign?.id ?? "")
        : level === "ad_group"
          ? String(row.adGroup?.id ?? row.ad_group?.id ?? "")
          : level === "ad"
            ? String(row.adGroupAd?.ad?.id ?? row.ad_group_ad?.ad?.id ?? "")
            : ""
    const entityRowId =
      level === "customer" ? customerRowId : entityMap.get(entityGoogleId)
    if (!entityRowId && level !== "customer") continue

    const data: Record<string, any> = {
      level,
      date,
      time_increment: "1",
      customer_id: level === "customer" ? customerRowId : null,
      campaign_id: level === "campaign" ? entityRowId : null,
      ad_group_id: level === "ad_group" ? entityRowId : null,
      ad_id: level === "ad" ? entityRowId : null,

      impressions: numericMetric(metrics.impressions),
      clicks: numericMetric(metrics.clicks),
      ctr: floatMetric(metrics.ctr),
      cost_micros: numericMetric(
        metrics.costMicros ?? metrics.cost_micros
      ),
      average_cpc_micros: numericMetric(
        metrics.averageCpc ?? metrics.average_cpc
      ),
      average_cpm_micros: numericMetric(
        metrics.averageCpm ?? metrics.average_cpm
      ),
      average_cpv_micros: numericMetric(
        metrics.trueviewAverageCpv ?? metrics.trueview_average_cpv
      ),
      conversions: floatMetric(metrics.conversions) ?? 0,
      conversions_value: floatMetric(
        metrics.conversionsValue ?? metrics.conversions_value
      ),
      all_conversions: floatMetric(
        metrics.allConversions ?? metrics.all_conversions
      ),
      all_conversions_value: floatMetric(
        metrics.allConversionsValue ?? metrics.all_conversions_value
      ),
      view_through_conversions: floatMetric(
        metrics.viewThroughConversions ?? metrics.view_through_conversions
      ),
      cost_per_conversion_micros: numericMetric(
        metrics.costPerConversion ?? metrics.cost_per_conversion
      ),
      video_views: numericMetric(
        metrics.videoTrueviewViews ?? metrics.video_trueview_views
      ),
      video_view_rate: floatMetric(
        metrics.videoTrueviewViewRate ?? metrics.video_trueview_view_rate
      ),
      video_quartile_p25_rate: floatMetric(
        metrics.videoQuartileP25Rate ?? metrics.video_quartile_p25_rate
      ),
      video_quartile_p50_rate: floatMetric(
        metrics.videoQuartileP50Rate ?? metrics.video_quartile_p50_rate
      ),
      video_quartile_p75_rate: floatMetric(
        metrics.videoQuartileP75Rate ?? metrics.video_quartile_p75_rate
      ),
      video_quartile_p100_rate: floatMetric(
        metrics.videoQuartileP100Rate ?? metrics.video_quartile_p100_rate
      ),
      engagements: numericMetric(metrics.engagements),
      engagement_rate: floatMetric(
        metrics.engagementRate ?? metrics.engagement_rate
      ),
      interactions: numericMetric(metrics.interactions),
      interaction_rate: floatMetric(
        metrics.interactionRate ?? metrics.interaction_rate
      ),
      search_impression_share: floatMetric(
        metrics.searchImpressionShare ?? metrics.search_impression_share
      ),
      search_top_impression_share: floatMetric(
        metrics.searchTopImpressionShare ??
          metrics.search_top_impression_share
      ),
      search_absolute_top_impression_share: floatMetric(
        metrics.searchAbsoluteTopImpressionShare ??
          metrics.search_absolute_top_impression_share
      ),
      device: breakdown === "device" ? segments.device ?? null : null,
      network:
        breakdown === "network"
          ? segments.adNetworkType ?? segments.ad_network_type ?? null
          : null,
      geo_country_code: null,
      geo_region: null,
      currency_code: currency,
      raw_data: row,
      synced_at: now,
    }

    const key = buildKey(data)
    const found = byKey.get(key)
    if (found) {
      await socials.updateGoogleAdsInsights([
        { selector: { id: found.id }, data },
      ])
    } else {
      await socials.createGoogleAdsInsights([data])
    }
    synced += 1
  }

  return synced
}

/**
 * Sum the BASE daily-insight rows (device == null && network == null) into a
 * rollup. Device/network-breakdown rows are skipped so they aren't double-counted
 * against the base series. Pure + exported for unit testing.
 */
export function sumBaseInsightRows(rows: any[]): {
  impressions: number
  clicks: number
  conversions: number
  cost_micros: number
} {
  const total = { impressions: 0, clicks: 0, conversions: 0, cost_micros: 0 }
  for (const r of rows) {
    // Only the base (un-segmented) series — breakdown rows carry device/network.
    if (r?.device != null || r?.network != null) continue
    total.impressions += numericMetric(r?.impressions)
    total.clicks += numericMetric(r?.clicks)
    total.conversions += numericMetric(r?.conversions)
    total.cost_micros += numericMetric(r?.cost_micros)
  }
  return total
}

/**
 * Recompute the rollup metric columns on campaign / ad_group / ad rows from the
 * FULL stored daily-insights history for the given entity row ids. Entities with
 * no stored base insight rows are left untouched (their window aggregate stands).
 */
async function recomputeRollupsFromInsights(
  socials: any,
  level: "campaign" | "ad_group" | "ad",
  entityRowIds: string[]
): Promise<void> {
  if (entityRowIds.length === 0) return
  const col =
    level === "campaign"
      ? "campaign_id"
      : level === "ad_group"
        ? "ad_group_id"
        : "ad_id"

  // One list for all entities at this level; group base rows by entity row id.
  const rows = await socials.listGoogleAdsInsights({
    level,
    [col]: entityRowIds,
  })

  const byEntity = new Map<string, any[]>()
  for (const r of rows) {
    const id = r?.[col]
    if (!id) continue
    const bucket = byEntity.get(id)
    if (bucket) bucket.push(r)
    else byEntity.set(id, [r])
  }

  const updates: Array<{ selector: { id: string }; data: Record<string, number> }> =
    []
  for (const [id, entityRows] of byEntity) {
    // Skip entities with no BASE rows — nothing to derive, keep existing rollup.
    const hasBase = entityRows.some(
      (r) => r?.device == null && r?.network == null
    )
    if (!hasBase) continue
    updates.push({ selector: { id }, data: sumBaseInsightRows(entityRows) })
  }
  if (updates.length === 0) return

  const updateFn =
    level === "campaign"
      ? "updateGoogleAdsCampaigns"
      : level === "ad_group"
        ? "updateGoogleAdsAdGroups"
        : "updateGoogleAdsAds"
  await socials[updateFn](updates)
}

/**
 * Decode Google Ads API errors into a human-readable line. The raw axios
 * `e.message` is just "Request failed with status code 403" — useless on
 * its own. Google packs the real reason into `response.data.error.details[].errors[]`
 * as a `GoogleAdsFailure`, but only when the developer token has enough
 * access to even produce one; at Test-access level it often returns a
 * bare 403 with no JSON body.
 *
 * We extract whatever signal we can find and append our own hint for the
 * two confusables operators run into most: missing login-customer-id and
 * Test-access dev tokens (the latter looks IDENTICAL to a missing-cid
 * error unless we explicitly call it out).
 */
export function formatGoogleAdsError(
  e: any,
  ctx: { hasLoginCid: boolean }
): string {
  const status: number | undefined = e?.response?.status
  // searchStream returns its error body as an array (`[{ error: … }]`) — unwrap
  // to the error object so 400/403 reasons aren't silently dropped.
  const data: any = googleErrorRoot(e?.response?.data)

  // Google's normal failure shape — extract the first specific error code.
  let specificCode: string | null = null
  let specificMessage: string | null = null

  const topMessage: string | null =
    (typeof data?.error?.message === "string" && data.error.message) || null

  const details: any[] = Array.isArray(data?.error?.details)
    ? data.error.details
    : []
  for (const detail of details) {
    const errors: any[] = Array.isArray(detail?.errors) ? detail.errors : []
    for (const err of errors) {
      const codeMap = err?.errorCode || {}
      // errorCode is a one-of: { authorizationError | authenticationError | ... }
      for (const k of Object.keys(codeMap)) {
        const v = codeMap[k]
        if (typeof v === "string") {
          specificCode = `${k}:${v}`
          specificMessage = err?.message || specificMessage
          break
        }
      }
      if (specificCode) break
    }
    if (specificCode) break
  }

  // Known authorization-error → operator-facing hint. Order matters:
  // check the most-specific code first.
  const code = specificCode || ""
  let hint: string | null = null

  if (code.includes("REQUESTED_METRICS_FOR_MANAGER")) {
    hint =
      "this CID is a manager (MCC) account — manager accounts have no campaign metrics, so metric queries always 400. Bind a child client-account CID instead of the manager. (The sync now auto-skips metric pulls for manager accounts, so this should not recur.)"
  } else if (status === 400 && code.startsWith("queryError")) {
    hint =
      "GAQL query rejected (400) — a requested field/metric is invalid for this account or Google Ads API v24. See the error message above for the offending field."
  } else if (
    code.includes("DEVELOPER_TOKEN_NOT_APPROVED") ||
    code.includes("DEVELOPER_TOKEN_PROHIBITED") ||
    code.includes("DEVELOPER_TOKEN_NEEDS_APPROVAL")
  ) {
    hint =
      "developer token is at Test access — production accounts return 403 until it's upgraded. Apply for Basic access at https://ads.google.com/aw/apicenter, or bind a customer with customer.test_account=true."
  } else if (code.includes("DEVELOPER_TOKEN_NOT_WHITELISTED_FOR_CUSTOMER")) {
    hint =
      "this customer is not whitelisted for the developer token. The token's MCC must be linked to this customer (or grant Basic access from the apicenter)."
  } else if (
    code.includes("USER_PERMISSION_DENIED") ||
    code.includes("CUSTOMER_NOT_ENABLED")
  ) {
    hint =
      "the OAuth user does not have access to this customer. Re-grant access in Google Ads → Tools → Access and security, or reconnect this platform with an account that has access."
  } else if (status === 403 && !ctx.hasLoginCid) {
    // Generic 403 with no specific code — most often missing login-customer-id.
    // Only surface this when we don't already have one set, otherwise the
    // hint is misleading.
    hint =
      "likely missing login-customer-id (set settings.login_customer_id on the binding to the manager/MCC CID, or GOOGLE_ADS_LOGIN_CUSTOMER_ID env) — or, if all three accessible CIDs return 403 even with login-customer-id, the developer token is at Test access (apply for Basic at https://ads.google.com/aw/apicenter)."
  } else if (status === 403 && ctx.hasLoginCid) {
    // Bare 403 *with* a login-customer-id set — almost always Test access.
    // Calling it out saves the operator a second round of debugging.
    hint =
      "login-customer-id is set but Google still returned 403. Most common cause: developer token is at Test access — production accounts return 403 regardless of login-customer-id. Verify at https://ads.google.com/aw/apicenter."
  }

  const parts: string[] = []
  if (specificMessage) parts.push(specificMessage)
  else if (topMessage) parts.push(topMessage)
  else parts.push(e?.message || "Unknown Google Ads error")
  if (specificCode) parts.push(`[${specificCode}]`)
  if (hint) parts.push(`— ${hint}`)

  return parts.join(" ")
}

// Google returns metric numerics as strings ("123") or numbers (12.3). Coerce
// to a Number that the BigNumber column can swallow. Returns null for missing.
function numericMetric(value: any): number {
  if (value === null || value === undefined || value === "") return 0
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function floatMetric(value: any): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeCid(value?: string | null): string | null {
  if (!value) return null
  const digits = String(value).replace(/\D/g, "")
  return digits.length ? digits : null
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
