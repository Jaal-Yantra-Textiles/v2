import axios from "axios"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { withGoogleRetry } from "../../../modules/social-provider/google-retry"

export type SyncSearchConsoleInput = {
  platform_id: string
  /** From the upstream refreshGoogleTokenStep */
  access_token: string
  /** Optional: scope to a single site_url; defaults to all `search-console` bindings */
  site_url?: string
  /** Window in days. Default 28 (GSC's own default). Max 16 months. */
  window_days?: number
  /**
   * Dimensions to request. Default ["date","query","page","country","device"].
   * Note: more dimensions → more rows → faster cap-out at 5000.
   */
  dimensions?: Array<
    "date" | "query" | "page" | "country" | "device" | "searchAppearance"
  >
  /** Row cap per sync call. Default 5000; max 25000 per GSC. */
  row_limit?: number
}

export type SyncSearchConsoleOutput = {
  platform_id: string
  sites_synced: number
  insights_rows_synced: number
  errors: Array<{ site_url: string; message: string }>
}

const GSC_API_BASE = "https://searchconsole.googleapis.com/webmasters/v3"

const DEFAULT_DIMENSIONS = ["date", "query", "page", "country", "device"]

/**
 * Pull-and-upsert Search Analytics data for every `search-console` binding
 * on a platform.
 *
 * Flow per site:
 *   1. POST searchAnalytics/query with the requested dimensions + date range.
 *   2. Upsert the site row (descriptive metadata + sync status).
 *   3. Upsert one insights row per returned key tuple. Existing rows for the
 *      same key are UPDATEd in place rather than appended.
 *
 * Best-effort per site: a failure on one site doesn't stop the rest, but the
 * error is recorded on the site row's `sync_status: "error"`.
 */
export const syncSearchConsoleStep = createStep(
  "sync-search-console-step",
  async (input: SyncSearchConsoleInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

    const windowDays = Math.min(Math.max(input.window_days ?? 28, 1), 480)
    const dimensions =
      input.dimensions && input.dimensions.length > 0
        ? input.dimensions
        : DEFAULT_DIMENSIONS
    const rowLimit = Math.min(Math.max(input.row_limit ?? 5000, 1), 25000)

    // Resolve target sites from bindings.
    const bindings = await socials.listSocialPlatformBindings({
      platform_id: input.platform_id,
      service: "search-console",
    })

    const targets = (
      input.site_url
        ? bindings.filter((b: any) => b.resource_id === input.site_url)
        : bindings
    ).map((b: any) => ({
      binding_id: b.id as string,
      site_url: String(b.resource_id),
      permission_level: (b.metadata?.permissionLevel as string) || null,
    }))

    if (targets.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        input.site_url
          ? `No Search Console binding for site ${input.site_url}`
          : "No Search Console bindings on this platform — bind a verified property first"
      )
    }

    const headers = {
      Authorization: `Bearer ${input.access_token}`,
      "Content-Type": "application/json",
    }

    const today = new Date()
    const endDate = formatDate(today)
    const start = new Date(today)
    // GSC has a ~2-day data lag; we still ask for "today" and let Google
    // return whatever's ready. Subtracting (windowDays - 1) makes the
    // returned window inclusive of today, matching what operators expect.
    start.setDate(start.getDate() - (windowDays - 1))
    const startDate = formatDate(start)

    let sitesSynced = 0
    let insightsRowsSynced = 0
    const errors: Array<{ site_url: string; message: string }> = []

    for (const t of targets) {
      try {
        const rows = await fetchSearchAnalytics({
          site_url: t.site_url,
          headers,
          startDate,
          endDate,
          dimensions,
          rowLimit,
          logger,
        })

        const siteRow = await upsertSite(socials, {
          platform_id: input.platform_id,
          binding_id: t.binding_id,
          site_url: t.site_url,
          permission_level: t.permission_level,
        })
        sitesSynced += 1

        const written = await upsertInsights(socials, {
          site_id: siteRow.id,
          rows,
          dimensions,
        })
        insightsRowsSynced += written
      } catch (e: any) {
        const msg = e.response?.data?.error?.message || e.message
        logger?.warn?.(
          `[gsc] sync failed for site=${t.site_url}: ${msg}`
        )
        errors.push({ site_url: t.site_url, message: msg })

        try {
          await markSiteError(socials, input.platform_id, t.site_url, msg)
        } catch {
          // ignore — the site row may not exist yet on first failed sync
        }
      }
    }

    return new StepResponse<SyncSearchConsoleOutput>({
      platform_id: input.platform_id,
      sites_synced: sitesSynced,
      insights_rows_synced: insightsRowsSynced,
      errors,
    })
  }
)

function formatDate(d: Date): string {
  // YYYY-MM-DD in UTC. GSC expects this exact format.
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function fetchSearchAnalytics(args: {
  site_url: string
  headers: Record<string, string>
  startDate: string
  endDate: string
  dimensions: string[]
  rowLimit: number
  logger?: Logger
}): Promise<any[]> {
  // GSC's site_url goes in the path encoded — sc-domain URLs contain ":"
  // which has to survive encodeURIComponent untouched (it's safe in path
  // segments, and Google's docs use the encoded form).
  const encoded = encodeURIComponent(args.site_url)
  const url = `${GSC_API_BASE}/sites/${encoded}/searchAnalytics/query`

  const body = {
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions: args.dimensions,
    rowLimit: args.rowLimit,
    // Google sorts by clicks DESC by default — that's exactly what we
    // want for the top-N rows we plan to render.
  }

  const res = await withGoogleRetry(
    () => axios.post(url, body, { headers: args.headers }),
    { label: `gsc.searchAnalytics(${args.site_url})`, logger: args.logger, maxAttempts: 3 }
  )

  return Array.isArray(res.data?.rows) ? res.data.rows : []
}

async function upsertSite(
  socials: any,
  data: {
    platform_id: string
    binding_id: string
    site_url: string
    permission_level: string | null
  }
) {
  const [existing] = await socials.listGoogleSearchConsoleSites(
    { platform_id: data.platform_id, site_url: data.site_url },
    { take: 1 }
  )
  const now = new Date()
  if (existing) {
    const [updated] = await socials.updateGoogleSearchConsoleSites([
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
  const [created] = await socials.createGoogleSearchConsoleSites([
    {
      ...data,
      last_synced_at: now,
      sync_status: "synced",
    },
  ])
  return created
}

async function markSiteError(
  socials: any,
  platform_id: string,
  site_url: string,
  message: string
) {
  const [existing] = await socials.listGoogleSearchConsoleSites(
    { platform_id, site_url },
    { take: 1 }
  )
  if (!existing) return
  await socials.updateGoogleSearchConsoleSites([
    {
      selector: { id: existing.id },
      data: { sync_status: "error", sync_error: message.slice(0, 1000) },
    },
  ])
}

async function upsertInsights(
  socials: any,
  args: { site_id: string; rows: any[]; dimensions: string[] }
): Promise<number> {
  const { site_id, rows, dimensions } = args
  if (rows.length === 0) return 0

  const now = new Date()

  // Pre-fetch existing rows for this site over the date range so we can
  // diff in memory rather than firing one SELECT per row. With a 5000-
  // row cap and ~28 days, this is at most ~140k rows to scan but in
  // practice much less.
  const dates = new Set<string>()
  for (const r of rows) {
    const idx = dimensions.indexOf("date")
    if (idx >= 0) dates.add(r.keys?.[idx])
  }
  const existing = dates.size
    ? await socials.listGoogleSearchConsoleInsights({
        site_id,
        date: [...dates],
      })
    : []

  const buildKey = (
    date: string,
    query: string | null,
    page: string | null,
    country: string | null,
    device: string | null,
    searchAppearance: string | null
  ) =>
    [
      date,
      query ?? "_",
      page ?? "_",
      country ?? "_",
      device ?? "_",
      searchAppearance ?? "_",
    ].join("|")

  const byKey = new Map<string, any>()
  for (const e of existing) {
    byKey.set(
      buildKey(
        e.date,
        e.query,
        e.page,
        e.country,
        e.device,
        e.search_appearance
      ),
      e
    )
  }

  let written = 0
  for (const row of rows) {
    const keys: string[] = Array.isArray(row.keys) ? row.keys : []
    const valueAt = (dim: string): string | null => {
      const i = dimensions.indexOf(dim)
      return i >= 0 ? keys[i] ?? null : null
    }
    const date = valueAt("date")
    if (!date) continue // every row must have a date; skip malformed

    const query = valueAt("query")
    const page = valueAt("page")
    const country = valueAt("country")
    const device = valueAt("device")
    const searchAppearance = valueAt("searchAppearance")

    const data = {
      site_id,
      date,
      query,
      page,
      country,
      device,
      search_appearance: searchAppearance,
      clicks: numericMetric(row.clicks),
      impressions: numericMetric(row.impressions),
      ctr: floatMetric(row.ctr),
      position: floatMetric(row.position),
      raw: row,
      synced_at: now,
    }

    const key = buildKey(date, query, page, country, device, searchAppearance)
    const found = byKey.get(key)
    if (found) {
      await socials.updateGoogleSearchConsoleInsights([
        { selector: { id: found.id }, data },
      ])
    } else {
      await socials.createGoogleSearchConsoleInsights([data])
    }
    written += 1
  }

  return written
}

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
