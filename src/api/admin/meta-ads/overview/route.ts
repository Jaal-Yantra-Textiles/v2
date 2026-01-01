import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import MetaAdsService from "../../../../modules/social-provider/meta-ads-service"
import { decryptAccessToken } from "../../../../modules/socials/utils/token-helpers"

type MetaAdsOverviewQuery = {
  platform_id: string
  ad_account_id: string
  level?: "account" | "campaign" | "adset" | "ad"
  object_id?: string
  date_preset?: string
  time_increment?: number
  include_audience?: boolean
  include_content?: boolean
  persist?: boolean
  refresh?: "auto" | "force" | "never"
  max_age_minutes?: number
}

type InsightRow = Record<string, any>

type AggregateTotals = {
  impressions: number
  reach: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
}

const parseNumber = (val: unknown): number => {
  if (val === null || val === undefined) return 0
  if (typeof val === "number") return Number.isFinite(val) ? val : 0
  if (typeof val === "bigint") {
    return Number(val)
  }
  if (typeof val === "string") {
    const n = Number(val)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof val === "object") {
    const maybe = val as any
    if (maybe?.value !== undefined && maybe?.value !== null) {
      return parseNumber(maybe.value)
    }
    if (typeof maybe?.toString === "function") {
      const str = String(maybe.toString())
      const n = Number(str)
      return Number.isFinite(n) ? n : 0
    }
  }
  return 0
}

const aggregateTotals = (rows: InsightRow[]): AggregateTotals => {
  let impressions = 0
  let reach = 0
  let clicks = 0
  let spend = 0

  for (const row of rows) {
    impressions += parseNumber(row.impressions)
    reach += parseNumber(row.reach)
    clicks += parseNumber(row.clicks)
    spend += parseNumber(row.spend)
  }

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
  const cpc = clicks > 0 ? spend / clicks : 0
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0

  return { impressions, reach, clicks, spend, ctr, cpc, cpm }
}

const aggregateActions = (rows: InsightRow[]): Record<string, number> => {
  const totals: Record<string, number> = {}

  for (const row of rows) {
    const actions = (row.actions as Array<{ action_type?: string; value?: string | number }>) || []
    for (const action of actions) {
      const type = String(action.action_type || "unknown")
      const value = parseNumber(action.value)
      totals[type] = (totals[type] || 0) + value
    }
  }

  return totals
}

const groupByBreakdown = (
  rows: InsightRow[],
  breakdownKeys: string[]
): Array<{ key: Record<string, string>; totals: AggregateTotals; results: Record<string, number> }> => {
  const groups = new Map<string, { key: Record<string, string>; rows: InsightRow[] }>()

  for (const row of rows) {
    const keyObj: Record<string, string> = {}
    for (const key of breakdownKeys) {
      const rawVal = row[key]
      keyObj[key] = rawVal === null || rawVal === undefined ? "unknown" : String(rawVal)
    }

    const stableKey = breakdownKeys.map((k) => `${k}:${keyObj[k]}`).join("|")

    if (!groups.has(stableKey)) {
      groups.set(stableKey, { key: keyObj, rows: [] })
    }

    groups.get(stableKey)!.rows.push(row)
  }

  const result: Array<{ key: Record<string, string>; totals: AggregateTotals; results: Record<string, number> }> = []

  for (const [, group] of groups.entries()) {
    result.push({
      key: group.key,
      totals: aggregateTotals(group.rows),
      results: aggregateActions(group.rows),
    })
  }

  return result.sort((a, b) => b.totals.spend - a.totals.spend)
}

const getBreakdownValue = (row: InsightRow, key: string): string | null => {
  const raw = row[key]
  if (raw === null || raw === undefined || raw === "") return null
  return String(raw)
}

const parseDate = (val: unknown): Date => {
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

const getPresetDays = (preset?: string): number | null => {
  switch (preset) {
    case "last_7d":
      return 7
    case "last_14d":
      return 14
    case "last_30d":
      return 30
    case "last_90d":
      return 90
    case "maximum":
      return null
    default:
      return 30
  }
}

const hasAnyBreakdown = (row: any): boolean => {
  return Boolean(
    row.age ||
      row.gender ||
      row.country ||
      row.region ||
      row.publisher_platform ||
      row.platform_position ||
      row.device_platform
  )
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = (req.validatedQuery || req.query) as unknown as MetaAdsOverviewQuery
  const logger = req.scope.resolve("logger") as any

  const coerceBoolean = (val: unknown, defaultValue: boolean): boolean => {
    if (val === undefined || val === null) return defaultValue
    if (typeof val === "boolean") return val
    if (typeof val === "number") return val !== 0
    if (typeof val === "string") {
      const s = val.trim().toLowerCase()
      if (s === "true" || s === "1" || s === "yes" || s === "y") return true
      if (s === "false" || s === "0" || s === "no" || s === "n") return false
    }
    return defaultValue
  }

  const coerceNumber = (val: unknown, defaultValue: number): number => {
    if (val === undefined || val === null) return defaultValue
    if (typeof val === "number") return Number.isFinite(val) ? val : defaultValue
    if (typeof val === "string") {
      const n = Number(val)
      return Number.isFinite(n) ? n : defaultValue
    }
    return defaultValue
  }

  const coerceRefresh = (val: unknown, defaultValue: "auto" | "force" | "never") => {
    const s = String(val ?? "").trim().toLowerCase()
    if (s === "auto" || s === "force" || s === "never") return s as any
    return defaultValue
  }

  const level = (query.level || "account") as "account" | "campaign" | "adset" | "ad"
  const includeAudience = coerceBoolean(query.include_audience, true)
  const includeContent = coerceBoolean(query.include_content, true)
  const persist = coerceBoolean(query.persist, false)
  const refresh = coerceRefresh(query.refresh, "auto")
  const maxAgeMinutes = coerceNumber(query.max_age_minutes, 60)

  logger.info(
    `[meta-ads/overview] parsed query refresh=${refresh} persist=${persist} include_audience=${includeAudience} include_content=${includeContent} max_age_minutes=${maxAgeMinutes} validatedQuery=${Boolean(
      (req as any).validatedQuery
    )}`
  )

  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService

  let objectId: string
  if (level === "account") {
    objectId = query.ad_account_id
  } else {
    if (!query.object_id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "object_id is required when level is not account")
    }
    objectId = query.object_id
  }

  const presetDays = getPresetDays(query.date_preset)
  const since = presetDays ? new Date(Date.now() - presetDays * 24 * 60 * 60 * 1000) : null
  if (since) {
    // Normalize to start-of-day to avoid time-of-day edge cases when persisted rows use midnight dates.
    since.setUTCHours(0, 0, 0, 0)
  }

  const withinRange = (row: any) => {
    if (!since) return true

    // Persisted insights can represent an aggregated range (date_start..date_stop).
    // Use date_stop to check overlap with the requested window.
    const stop = row?.date_stop ? new Date(row.date_stop) : null
    if (stop && !Number.isNaN(stop.getTime())) {
      return stop.getTime() >= since.getTime()
    }

    const start = row?.date_start ? new Date(row.date_start) : null
    if (!start || Number.isNaN(start.getTime())) return true
    return start.getTime() >= since.getTime()
  }

  const scopeFilters: Record<string, any> = {
    level,
    meta_account_id: query.ad_account_id,
  }
  if (level === "campaign") scopeFilters.meta_campaign_id = objectId
  if (level === "adset") scopeFilters.meta_adset_id = objectId
  if (level === "ad") scopeFilters.meta_ad_id = objectId

  // Determine last synced timestamp from DB
  let lastSyncedAt: Date | null = null
  let scopedInsights: any[] = []
  try {
    scopedInsights = (await socials.listAdInsights(scopeFilters as any)) as any[]
    logger.info(`[meta-ads/overview] scopedInsights=${scopedInsights.length} level=${level} objectId=${objectId}`)
    for (const row of scopedInsights) {
      if (!row?.synced_at) continue
      const d = new Date(row.synced_at)
      if (Number.isNaN(d.getTime())) continue
      if (!lastSyncedAt || d.getTime() > lastSyncedAt.getTime()) {
        lastSyncedAt = d
      }
    }
  } catch (e) {
    logger.warn(`[meta-ads/overview] listAdInsights failed, proceeding without DB cache`, e)
    scopedInsights = []
    lastSyncedAt = null
  }

  const isFresh =
    lastSyncedAt && Date.now() - lastSyncedAt.getTime() <= maxAgeMinutes * 60 * 1000

  const inRangeRows = scopedInsights.filter(withinRange)
  logger.info(
    `[meta-ads/overview] inRangeRows=${inRangeRows.length} lastSyncedAt=${lastSyncedAt ? lastSyncedAt.toISOString() : "null"} isFresh=${Boolean(
      isFresh
    )}`
  )

  const isAgeGenderOnly = (r: any) =>
    (Boolean(r.age) || Boolean(r.gender)) &&
    !r.country &&
    !r.region &&
    !r.publisher_platform &&
    !r.platform_position &&
    !r.device_platform

  const isCountryOnly = (r: any) =>
    Boolean(r.country) &&
    !r.age &&
    !r.gender &&
    !r.region &&
    !r.publisher_platform &&
    !r.platform_position &&
    !r.device_platform

  const isPublisherOnly = (r: any) =>
    Boolean(r.publisher_platform) &&
    !r.age &&
    !r.gender &&
    !r.country &&
    !r.region &&
    !r.platform_position &&
    !r.device_platform

  const isDeviceOnly = (r: any) =>
    Boolean(r.device_platform) &&
    !r.age &&
    !r.gender &&
    !r.country &&
    !r.region &&
    !r.publisher_platform &&
    !r.platform_position

  const isPositionOnly = (r: any) =>
    Boolean(r.platform_position) &&
    !r.age &&
    !r.gender &&
    !r.country &&
    !r.region &&
    !r.publisher_platform &&
    !r.device_platform

  const baseRowsInRange = inRangeRows.filter((r) => !hasAnyBreakdown(r))
  const countryOnlyRows = inRangeRows.filter(isCountryOnly)
  const publisherOnlyRows = inRangeRows.filter(isPublisherOnly)
  const deviceOnlyRows = inRangeRows.filter(isDeviceOnly)
  const positionOnlyRows = inRangeRows.filter(isPositionOnly)
  const ageGenderOnlyRows = inRangeRows.filter(isAgeGenderOnly)

  const totalsRowsInRange =
    baseRowsInRange.length > 0
      ? baseRowsInRange
      : countryOnlyRows.length > 0
        ? countryOnlyRows
        : publisherOnlyRows.length > 0
          ? publisherOnlyRows
          : deviceOnlyRows.length > 0
            ? deviceOnlyRows
            : positionOnlyRows.length > 0
              ? positionOnlyRows
              : ageGenderOnlyRows.length > 0
                ? ageGenderOnlyRows
                : []

  const hasTotalsRowsInRange = totalsRowsInRange.length > 0
  logger.info(
    `[meta-ads/overview] totalsRowsInRange=${totalsRowsInRange.length} base=${baseRowsInRange.length} country=${countryOnlyRows.length} publisher=${publisherOnlyRows.length} device=${deviceOnlyRows.length} position=${positionOnlyRows.length} ageGender=${ageGenderOnlyRows.length}`
  )

  const useDb = refresh === "never" || (refresh === "auto" && Boolean(isFresh) && hasTotalsRowsInRange)
  logger.info(`[meta-ads/overview] useDb=${useDb} (refresh=${refresh})`)

  if (refresh === "never" && scopedInsights.length === 0) {
    logger.warn(`[meta-ads/overview] refresh=never but no scopedInsights in DB`)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No synced AdInsights found for this scope. Run insights sync first or use refresh=force."
    )
  }

  if (refresh === "never" && !hasTotalsRowsInRange) {
    logger.warn(
      `[meta-ads/overview] refresh=never but no usable totalsRowsInRange for requested range. inRangeRows=${inRangeRows.length}`
    )
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No usable AdInsights found for this scope in the requested range. Run insights sync/persist first, or use refresh=force."
    )
  }

  const timeIncrement = String(coerceNumber(query.time_increment, 1))

  const resolveInternalLinks = async (data: Record<string, any>) => {
    if (data.meta_campaign_id) {
      const campaigns = await socials.listAdCampaigns({ meta_campaign_id: data.meta_campaign_id })
      if (campaigns?.[0]) {
        data.campaign_id = campaigns[0].id
      }
    }

    if (data.meta_adset_id) {
      const adsets = await socials.listAdSets({ meta_adset_id: data.meta_adset_id })
      if (adsets?.[0]) {
        data.adset_id = adsets[0].id
      }
    }

    if (data.meta_ad_id) {
      const ads = await socials.listAds({ meta_ad_id: data.meta_ad_id })
      if (ads?.[0]) {
        data.ad_id = ads[0].id
      }
    }
  }

  const upsertAdInsightRow = async (row: InsightRow) => {
    const dateStart = parseDate(row.date_start)
    const dateStop = parseDate(row.date_stop)

    const metaCampaignId = row.campaign_id || (level === "campaign" ? objectId : null)
    const metaAdsetId = row.adset_id || (level === "adset" ? objectId : null)
    const metaAdId = row.ad_id || (level === "ad" ? objectId : null)

    const insightData: Record<string, any> = {
      date_start: dateStart,
      date_stop: dateStop,
      time_increment: timeIncrement,
      level,

      meta_account_id: query.ad_account_id,
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
      level,
      meta_account_id: query.ad_account_id,
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
      const eiStart = new Date(ei.date_start).toISOString()
      const eiStop = new Date(ei.date_stop).toISOString()
      return eiStart === dateStart.toISOString() && eiStop === dateStop.toISOString()
    })

    if (match?.id) {
      logger.info(
        `[meta-ads/overview] persist update id=${match.id} level=${level} date_start=${dateStart.toISOString()} date_stop=${dateStop.toISOString()} campaign=${metaCampaignId || ""} adset=${metaAdsetId || ""} ad=${metaAdId || ""} breakdowns=${[
          insightData.age,
          insightData.gender,
          insightData.country,
          insightData.publisher_platform,
          insightData.platform_position,
          insightData.device_platform,
        ]
          .filter(Boolean)
          .join("|")}`
      )
      await socials.updateAdInsights([
        {
          selector: { id: match.id },
          data: insightData,
        },
      ] as any)
      return { created: 0, updated: 1 }
    }

    logger.info(
      `[meta-ads/overview] persist create level=${level} date_start=${dateStart.toISOString()} date_stop=${dateStop.toISOString()} campaign=${metaCampaignId || ""} adset=${metaAdsetId || ""} ad=${metaAdId || ""} breakdowns=${[
        insightData.age,
        insightData.gender,
        insightData.country,
        insightData.publisher_platform,
        insightData.platform_position,
        insightData.device_platform,
      ]
        .filter(Boolean)
        .join("|")}`
    )
    await socials.createAdInsights(insightData as any)
    return { created: 1, updated: 0 }
  }

  const persistence = {
    enabled: persist && !useDb,
    created: 0,
    updated: 0,
    errors: 0,
  }

  const response: Record<string, any> = {
    scope: {
      platform_id: query.platform_id,
      ad_account_id: query.ad_account_id,
      level,
      object_id: level === "account" ? undefined : objectId,
      date_preset: query.date_preset || "last_30d",
      time_increment: query.time_increment,
      last_synced_at: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    },
    totals: { impressions: 0, reach: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0 },
    results: {},
    audience: null as any,
    content: null as any,
    capabilities: {
      remote_ad_creation: {
        supported: false,
      },
    },
    persistence,
    data_source: useDb ? "db" : "meta",
  }

  if (useDb) {
    const rows = scopedInsights.filter(withinRange)

    // Avoid double counting: totals/results must be computed from a single non-overlapping set.
    // Prefer base (non-breakdown) rows; otherwise fall back to a single breakdown dimension set.
    response.totals = aggregateTotals(totalsRowsInRange)
    response.results = aggregateActions(totalsRowsInRange)

    if (includeAudience) {
      const ageGenderRows = rows.filter((r) => Boolean(r.age) || Boolean(r.gender))
      const countryRows = rows.filter((r) => Boolean(r.country))
      response.audience = {
        by_age_gender: groupByBreakdown(ageGenderRows, ["age", "gender"]),
        by_country: groupByBreakdown(countryRows, ["country"]),
      }
    }

    if (includeContent) {
      const publisherRows = rows.filter((r) => Boolean(r.publisher_platform))
      const positionRows = rows.filter((r) => Boolean(r.platform_position))
      const deviceRows = rows.filter((r) => Boolean(r.device_platform))
      response.content = {
        by_publisher_platform: groupByBreakdown(publisherRows, ["publisher_platform"]),
        by_platform_position: groupByBreakdown(positionRows, ["platform_position"]),
        by_device_platform: groupByBreakdown(deviceRows, ["device_platform"]),
      }
    }

    return res.json(response)
  }

  const platform = await socials.retrieveSocialPlatform(query.platform_id)
  if (!platform) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Platform not found")
  }

  const apiConfig = (platform as any).api_config as Record<string, any>
  if (!apiConfig) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Platform has no API configuration")
  }

  const accessToken = decryptAccessToken(apiConfig, req.scope)

  const metaAds = new MetaAdsService()

  const breakdownFields = [
    "impressions",
    "clicks",
    "spend",
    "reach",
    "actions",
    "cpc",
    "cpm",
    "ctr",
  ]

  const baseInsights = await metaAds.getInsights(objectId, accessToken, {
    level: level === "account" ? "account" : undefined,
    date_preset: query.date_preset || "last_30d",
    time_increment: query.time_increment,
  })

  const baseRows = ((baseInsights as any).data as InsightRow[]) || []
  response.totals = aggregateTotals(baseRows)
  response.results = aggregateActions(baseRows)

  if (persist) {
    logger.info(
      `[meta-ads/overview] persist enabled. useDb=${useDb} includeAudience=${includeAudience} includeContent=${includeContent}`
    )
    let debugLogged = 0
    for (const row of baseRows) {
      try {
        if (debugLogged < 5) {
          debugLogged += 1
          logger.info(
            `[meta-ads/overview] persist(base) sample date_start=${String(row.date_start)} date_stop=${String(
              row.date_stop
            )}`
          )
        }
        const r = await upsertAdInsightRow(row)
        persistence.created += r.created
        persistence.updated += r.updated
      } catch (e) {
        persistence.errors += 1
        logger.error(`[meta-ads/overview] persist(base) failed`, e)
      }
    }
  }

  if (includeAudience) {
    let ageGenderRows: InsightRow[] = []
    let countryRows: InsightRow[] = []

    try {
      const ageGenderInsights = await metaAds.getInsights(objectId, accessToken, {
        level: level === "account" ? "account" : undefined,
        date_preset: query.date_preset || "last_30d",
        time_increment: query.time_increment,
        breakdowns: ["age", "gender"],
        fields: breakdownFields,
      })
      ageGenderRows = ((ageGenderInsights as any).data as InsightRow[]) || []
    } catch (e) {
      ageGenderRows = []
    }

    try {
      const countryInsights = await metaAds.getInsights(objectId, accessToken, {
        level: level === "account" ? "account" : undefined,
        date_preset: query.date_preset || "last_30d",
        time_increment: query.time_increment,
        breakdowns: ["country"],
        fields: breakdownFields,
      })
      countryRows = ((countryInsights as any).data as InsightRow[]) || []
    } catch (e) {
      countryRows = []
    }

    response.audience = {
      by_age_gender: groupByBreakdown(ageGenderRows, ["age", "gender"]),
      by_country: groupByBreakdown(countryRows, ["country"]),
    }

    if (persist) {
      for (const row of ageGenderRows) {
        try {
          const r = await upsertAdInsightRow(row)
          persistence.created += r.created
          persistence.updated += r.updated
        } catch (e) {
          persistence.errors += 1
          logger.error(`[meta-ads/overview] persist(audience age_gender) failed`, e)
        }
      }

      for (const row of countryRows) {
        try {
          const r = await upsertAdInsightRow(row)
          persistence.created += r.created
          persistence.updated += r.updated
        } catch (e) {
          persistence.errors += 1
          logger.error(`[meta-ads/overview] persist(audience country) failed`, e)
        }
      }
    }
  }

  if (includeContent) {
    let publisherRows: InsightRow[] = []
    let positionRows: InsightRow[] = []
    let deviceRows: InsightRow[] = []

    try {
      const publisherInsights = await metaAds.getInsights(objectId, accessToken, {
        level: level === "account" ? "account" : undefined,
        date_preset: query.date_preset || "last_30d",
        time_increment: query.time_increment,
        breakdowns: ["publisher_platform"],
        fields: breakdownFields,
      })
      publisherRows = ((publisherInsights as any).data as InsightRow[]) || []
    } catch (e) {
      publisherRows = []
    }

    try {
      const positionInsights = await metaAds.getInsights(objectId, accessToken, {
        level: level === "account" ? "account" : undefined,
        date_preset: query.date_preset || "last_30d",
        time_increment: query.time_increment,
        breakdowns: ["platform_position"],
        fields: breakdownFields,
      })
      positionRows = ((positionInsights as any).data as InsightRow[]) || []
    } catch (e) {
      positionRows = []
    }

    try {
      const deviceInsights = await metaAds.getInsights(objectId, accessToken, {
        level: level === "account" ? "account" : undefined,
        date_preset: query.date_preset || "last_30d",
        time_increment: query.time_increment,
        breakdowns: ["device_platform"],
        fields: breakdownFields,
      })
      deviceRows = ((deviceInsights as any).data as InsightRow[]) || []
    } catch (e) {
      deviceRows = []
    }

    response.content = {
      by_publisher_platform: groupByBreakdown(publisherRows, ["publisher_platform"]),
      by_platform_position: groupByBreakdown(positionRows, ["platform_position"]),
      by_device_platform: groupByBreakdown(deviceRows, ["device_platform"]),
    }

    if (persist) {
      for (const row of publisherRows) {
        try {
          const r = await upsertAdInsightRow(row)
          persistence.created += r.created
          persistence.updated += r.updated
        } catch (e) {
          persistence.errors += 1
          logger.error(`[meta-ads/overview] persist(content publisher_platform) failed`, e)
        }
      }

      for (const row of positionRows) {
        try {
          const r = await upsertAdInsightRow(row)
          persistence.created += r.created
          persistence.updated += r.updated
        } catch (e) {
          persistence.errors += 1
          logger.error(`[meta-ads/overview] persist(content platform_position) failed`, e)
        }
      }

      for (const row of deviceRows) {
        try {
          const r = await upsertAdInsightRow(row)
          persistence.created += r.created
          persistence.updated += r.updated
        } catch (e) {
          persistence.errors += 1
          logger.error(`[meta-ads/overview] persist(content device_platform) failed`, e)
        }
      }
    }
  }

  res.json(response)
}
