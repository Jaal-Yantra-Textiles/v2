import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import SocialsService from "../../../modules/socials/service"
import MetaAdsService from "../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../modules/socials/utils/token-helpers"
import type { FetchOverviewInput, FetchedRows, InsightRow } from "./types"
import {
  parseNumber,
  parseDate,
  getBreakdownValue,
  getPresetDays,
  hasAnyBreakdown,
  aggregateTotals,
  aggregateActions,
  groupByBreakdown,
} from "./utils"

// ─── Step 1: Check DB cache ───────────────────────────────────────────────────

export const checkCacheStep = createStep(
  "meta-ads-check-cache",
  async (input: FetchOverviewInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const scopeFilters: Record<string, any> = {
      level: input.level,
      meta_account_id: input.ad_account_id,
    }
    if (input.level === "campaign") scopeFilters.meta_campaign_id = input.objectId
    if (input.level === "adset") scopeFilters.meta_adset_id = input.objectId
    if (input.level === "ad") scopeFilters.meta_ad_id = input.objectId

    let scopedInsights: any[] = []
    let lastSyncedAt: string | null = null

    try {
      scopedInsights = (await socials.listAdInsights(scopeFilters as any)) as any[]
      for (const row of scopedInsights) {
        if (!row?.synced_at) continue
        const d = new Date(row.synced_at)
        if (Number.isNaN(d.getTime())) continue
        if (!lastSyncedAt || d.getTime() > new Date(lastSyncedAt).getTime()) {
          lastSyncedAt = d.toISOString()
        }
      }
    } catch {
      scopedInsights = []
      lastSyncedAt = null
    }

    const isFresh = lastSyncedAt
      ? Date.now() - new Date(lastSyncedAt).getTime() <= input.max_age_minutes * 60 * 1000
      : false

    // Determine usable totals rows within the requested date range
    const presetDays = getPresetDays(input.date_preset)
    let since: Date | null = null
    if (presetDays) {
      since = new Date(Date.now() - presetDays * 24 * 60 * 60 * 1000)
      since.setUTCHours(0, 0, 0, 0)
    }

    const withinRange = (row: any) => {
      if (!since) return true
      const stop = row?.date_stop ? new Date(row.date_stop) : null
      if (stop && !Number.isNaN(stop.getTime())) return stop.getTime() >= since.getTime()
      const start = row?.date_start ? new Date(row.date_start) : null
      if (!start || Number.isNaN(start.getTime())) return true
      return start.getTime() >= since.getTime()
    }

    const inRangeRows = scopedInsights.filter(withinRange)

    const isAgeGenderOnly = (r: any) =>
      (Boolean(r.age) || Boolean(r.gender)) && !r.country && !r.region &&
      !r.publisher_platform && !r.platform_position && !r.device_platform

    const isCountryOnly = (r: any) =>
      Boolean(r.country) && !r.age && !r.gender && !r.region &&
      !r.publisher_platform && !r.platform_position && !r.device_platform

    const isPublisherOnly = (r: any) =>
      Boolean(r.publisher_platform) && !r.age && !r.gender && !r.country &&
      !r.region && !r.platform_position && !r.device_platform

    const isDeviceOnly = (r: any) =>
      Boolean(r.device_platform) && !r.age && !r.gender && !r.country &&
      !r.region && !r.publisher_platform && !r.platform_position

    const isPositionOnly = (r: any) =>
      Boolean(r.platform_position) && !r.age && !r.gender && !r.country &&
      !r.region && !r.publisher_platform && !r.device_platform

    const baseRows = inRangeRows.filter((r) => !hasAnyBreakdown(r))
    const hasTotalsRowsInRange =
      baseRows.length > 0 ||
      inRangeRows.filter(isCountryOnly).length > 0 ||
      inRangeRows.filter(isPublisherOnly).length > 0 ||
      inRangeRows.filter(isDeviceOnly).length > 0 ||
      inRangeRows.filter(isPositionOnly).length > 0 ||
      inRangeRows.filter(isAgeGenderOnly).length > 0

    const useDb =
      input.refresh === "never" ||
      (input.refresh === "auto" && isFresh && hasTotalsRowsInRange)

    if (input.refresh === "never" && scopedInsights.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No synced AdInsights found for this scope. Run insights sync first or use refresh=force."
      )
    }
    if (input.refresh === "never" && !hasTotalsRowsInRange) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No usable AdInsights found for this scope in the requested range. Run insights sync/persist first, or use refresh=force."
      )
    }

    return new StepResponse({ scopedInsights, useDb, lastSyncedAt })
  }
)

// ─── Step 2: Fetch from Meta API ──────────────────────────────────────────────

const BREAKDOWN_FIELDS = ["impressions", "clicks", "spend", "reach", "actions", "cpc", "cpm", "ctr"]

export const fetchFromMetaStep = createStep(
  "meta-ads-fetch-meta",
  async (
    { input, useDb }: { input: FetchOverviewInput; useDb: boolean },
    { container }
  ) => {
    const empty: FetchedRows = {
      baseRows: [], ageGenderRows: [], countryRows: [],
      publisherRows: [], positionRows: [], deviceRows: [],
    }
    if (useDb) return new StepResponse(empty)

    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const platform = await socials.retrieveSocialPlatform(input.platform_id)
    if (!platform) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Platform not found")
    }
    const apiConfig = (platform as any).api_config as Record<string, any>
    if (!apiConfig) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Platform has no API configuration")
    }
    const accessToken = decryptAccessToken(apiConfig, container)
    const metaAds = new MetaAdsService()

    const baseOpts = {
      level: input.level === "account" ? ("account" as const) : undefined,
      date_preset: input.date_preset,
      time_increment: input.time_increment,
    }

    const [baseRes, ageGenderRes, countryRes, publisherRes, positionRes, deviceRes] =
      await Promise.allSettled([
        metaAds.getInsights(input.objectId, accessToken, baseOpts),
        metaAds.getInsights(input.objectId, accessToken, { ...baseOpts, breakdowns: ["age", "gender"], fields: BREAKDOWN_FIELDS }),
        metaAds.getInsights(input.objectId, accessToken, { ...baseOpts, breakdowns: ["country"], fields: BREAKDOWN_FIELDS }),
        metaAds.getInsights(input.objectId, accessToken, { ...baseOpts, breakdowns: ["publisher_platform"], fields: BREAKDOWN_FIELDS }),
        metaAds.getInsights(input.objectId, accessToken, { ...baseOpts, breakdowns: ["platform_position"], fields: BREAKDOWN_FIELDS }),
        metaAds.getInsights(input.objectId, accessToken, { ...baseOpts, breakdowns: ["device_platform"], fields: BREAKDOWN_FIELDS }),
      ])

    const safeRows = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? ((r.value as any).data as InsightRow[]) || [] : []

    return new StepResponse({
      baseRows: safeRows(baseRes),
      ageGenderRows: safeRows(ageGenderRes),
      countryRows: safeRows(countryRes),
      publisherRows: safeRows(publisherRes),
      positionRows: safeRows(positionRes),
      deviceRows: safeRows(deviceRes),
    } as FetchedRows)
  }
)

// ─── Step 3: Persist to DB ────────────────────────────────────────────────────

export const persistInsightsStep = createStep(
  "meta-ads-persist-insights",
  async (
    {
      input,
      useDb,
      fetched,
    }: { input: FetchOverviewInput; useDb: boolean; fetched: FetchedRows },
    { container }
  ) => {
    if (!input.persist || useDb) {
      return new StepResponse({ created: 0, updated: 0, errors: 0 })
    }

    const socials = container.resolve(SOCIALS_MODULE) as SocialsService
    const timeIncrement = String(input.time_increment)
    let created = 0, updated = 0, errors = 0

    const resolveInternalLinks = async (data: Record<string, any>) => {
      if (data.meta_campaign_id) {
        const campaigns = await socials.listAdCampaigns({ meta_campaign_id: data.meta_campaign_id })
        if (campaigns?.[0]) data.campaign_id = campaigns[0].id
      }
      if (data.meta_adset_id) {
        const adsets = await socials.listAdSets({ meta_adset_id: data.meta_adset_id })
        if (adsets?.[0]) data.adset_id = adsets[0].id
      }
      if (data.meta_ad_id) {
        const ads = await socials.listAds({ meta_ad_id: data.meta_ad_id })
        if (ads?.[0]) data.ad_id = ads[0].id
      }
    }

    const upsert = async (row: InsightRow) => {
      const dateStart = parseDate(row.date_start)
      const dateStop = parseDate(row.date_stop)
      const metaCampaignId = row.campaign_id || (input.level === "campaign" ? input.objectId : null)
      const metaAdsetId = row.adset_id || (input.level === "adset" ? input.objectId : null)
      const metaAdId = row.ad_id || (input.level === "ad" ? input.objectId : null)

      const insightData: Record<string, any> = {
        date_start: dateStart,
        date_stop: dateStop,
        time_increment: timeIncrement,
        level: input.level,
        meta_account_id: input.ad_account_id,
        meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId,
        meta_ad_id: metaAdId,
        impressions: parseNumber(row.impressions),
        reach: parseNumber(row.reach),
        clicks: parseNumber(row.clicks),
        spend: parseNumber(row.spend),
        ctr: row.ctr !== undefined && row.ctr !== null ? parseNumber(row.ctr) : null,
        cpc: row.cpc !== undefined && row.cpc !== null ? parseNumber(row.cpc) : null,
        cpm: row.cpm !== undefined && row.cpm !== null ? parseNumber(row.cpm) : null,
        actions: row.actions || null,
        age: getBreakdownValue(row, "age"),
        gender: getBreakdownValue(row, "gender"),
        country: getBreakdownValue(row, "country"),
        region: getBreakdownValue(row, "region"),
        publisher_platform: getBreakdownValue(row, "publisher_platform"),
        platform_position: getBreakdownValue(row, "platform_position"),
        device_platform: getBreakdownValue(row, "device_platform"),
        raw_data: row,
        synced_at: new Date(),
      }

      await resolveInternalLinks(insightData)

      const filters: Record<string, any> = {
        level: input.level,
        meta_account_id: input.ad_account_id,
        meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId,
        meta_ad_id: metaAdId,
        age: insightData.age,
        gender: insightData.gender,
        country: insightData.country,
        region: insightData.region,
        publisher_platform: insightData.publisher_platform,
        platform_position: insightData.platform_position,
        device_platform: insightData.device_platform,
      }

      const existing = await socials.listAdInsights(filters as any)
      const match = (existing as any[]).find((ei: any) => {
        if (!ei.date_start || !ei.date_stop) return false
        return (
          new Date(ei.date_start).toISOString() === dateStart.toISOString() &&
          new Date(ei.date_stop).toISOString() === dateStop.toISOString()
        )
      })

      if (match?.id) {
        await socials.updateAdInsights([{ selector: { id: match.id }, data: insightData }] as any)
        return { created: 0, updated: 1 }
      }
      await socials.createAdInsights(insightData as any)
      return { created: 1, updated: 0 }
    }

    const allRows = [
      ...fetched.baseRows,
      ...fetched.ageGenderRows,
      ...fetched.countryRows,
      ...fetched.publisherRows,
      ...fetched.positionRows,
      ...fetched.deviceRows,
    ]

    for (const row of allRows) {
      try {
        const r = await upsert(row)
        created += r.created
        updated += r.updated
      } catch {
        errors++
      }
    }

    return new StepResponse({ created, updated, errors })
  }
)

// ─── Step 4: Aggregate and build response ─────────────────────────────────────

export const aggregateResponseStep = createStep(
  "meta-ads-aggregate",
  async (
    {
      input,
      useDb,
      scopedInsights,
      lastSyncedAt,
      fetched,
      persistStats,
    }: {
      input: FetchOverviewInput
      useDb: boolean
      scopedInsights: any[]
      lastSyncedAt: string | null
      fetched: FetchedRows
      persistStats: { created: number; updated: number; errors: number }
    }
  ) => {
    const presetDays = getPresetDays(input.date_preset)
    let since: Date | null = null
    if (presetDays) {
      since = new Date(Date.now() - presetDays * 24 * 60 * 60 * 1000)
      since.setUTCHours(0, 0, 0, 0)
    }

    const withinRange = (row: any) => {
      if (!since) return true
      const stop = row?.date_stop ? new Date(row.date_stop) : null
      if (stop && !Number.isNaN(stop.getTime())) return stop.getTime() >= since.getTime()
      const start = row?.date_start ? new Date(row.date_start) : null
      if (!start || Number.isNaN(start.getTime())) return true
      return start.getTime() >= since.getTime()
    }

    const persistence = {
      enabled: input.persist && !useDb,
      ...persistStats,
    }

    const response: Record<string, any> = {
      scope: {
        platform_id: input.platform_id,
        ad_account_id: input.ad_account_id,
        level: input.level,
        object_id: input.level === "account" ? undefined : input.objectId,
        date_preset: input.date_preset,
        time_increment: input.time_increment,
        last_synced_at: lastSyncedAt,
      },
      totals: { impressions: 0, reach: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0 },
      results: {},
      audience: null,
      content: null,
      capabilities: { remote_ad_creation: { supported: false } },
      persistence,
      data_source: useDb ? "db" : "meta",
    }

    if (useDb) {
      const rows = scopedInsights.filter(withinRange)

      const isAgeGenderOnly = (r: any) =>
        (Boolean(r.age) || Boolean(r.gender)) && !r.country && !r.region &&
        !r.publisher_platform && !r.platform_position && !r.device_platform
      const isCountryOnly = (r: any) =>
        Boolean(r.country) && !r.age && !r.gender && !r.region &&
        !r.publisher_platform && !r.platform_position && !r.device_platform
      const isPublisherOnly = (r: any) =>
        Boolean(r.publisher_platform) && !r.age && !r.gender && !r.country &&
        !r.region && !r.platform_position && !r.device_platform
      const isDeviceOnly = (r: any) =>
        Boolean(r.device_platform) && !r.age && !r.gender && !r.country &&
        !r.region && !r.publisher_platform && !r.platform_position
      const isPositionOnly = (r: any) =>
        Boolean(r.platform_position) && !r.age && !r.gender && !r.country &&
        !r.region && !r.publisher_platform && !r.device_platform

      const baseRows = rows.filter((r) => !hasAnyBreakdown(r))
      const countryOnlyRows = rows.filter(isCountryOnly)
      const publisherOnlyRows = rows.filter(isPublisherOnly)
      const deviceOnlyRows = rows.filter(isDeviceOnly)
      const positionOnlyRows = rows.filter(isPositionOnly)
      const ageGenderOnlyRows = rows.filter(isAgeGenderOnly)

      const totalsRows =
        baseRows.length > 0 ? baseRows :
        countryOnlyRows.length > 0 ? countryOnlyRows :
        publisherOnlyRows.length > 0 ? publisherOnlyRows :
        deviceOnlyRows.length > 0 ? deviceOnlyRows :
        positionOnlyRows.length > 0 ? positionOnlyRows :
        ageGenderOnlyRows.length > 0 ? ageGenderOnlyRows : []

      response.totals = aggregateTotals(totalsRows)
      response.results = aggregateActions(totalsRows)

      if (input.include_audience) {
        response.audience = {
          by_age_gender: groupByBreakdown(rows.filter((r) => Boolean(r.age) || Boolean(r.gender)), ["age", "gender"]),
          by_country: groupByBreakdown(rows.filter((r) => Boolean(r.country)), ["country"]),
        }
      }

      if (input.include_content) {
        response.content = {
          by_publisher_platform: groupByBreakdown(rows.filter((r) => Boolean(r.publisher_platform)), ["publisher_platform"]),
          by_platform_position: groupByBreakdown(rows.filter((r) => Boolean(r.platform_position)), ["platform_position"]),
          by_device_platform: groupByBreakdown(rows.filter((r) => Boolean(r.device_platform)), ["device_platform"]),
        }
      }
    } else {
      response.totals = aggregateTotals(fetched.baseRows)
      response.results = aggregateActions(fetched.baseRows)

      if (input.include_audience) {
        response.audience = {
          by_age_gender: groupByBreakdown(fetched.ageGenderRows, ["age", "gender"]),
          by_country: groupByBreakdown(fetched.countryRows, ["country"]),
        }
      }

      if (input.include_content) {
        response.content = {
          by_publisher_platform: groupByBreakdown(fetched.publisherRows, ["publisher_platform"]),
          by_platform_position: groupByBreakdown(fetched.positionRows, ["platform_position"]),
          by_device_platform: groupByBreakdown(fetched.deviceRows, ["device_platform"]),
        }
      }
    }

    return new StepResponse(response)
  }
)
