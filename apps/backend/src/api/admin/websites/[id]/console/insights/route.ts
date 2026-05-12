import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../../modules/socials"
import { resolveSearchConsoleBindingForWebsite } from "../../../../../../lib/search-console-resolver"

/**
 * GET /admin/websites/:id/console/insights
 *
 * Returns daily Search Analytics rows for the website's bound GSC site.
 *
 * Query params:
 *   from        YYYY-MM-DD  (inclusive)        default: 28 days ago
 *   to          YYYY-MM-DD  (inclusive)        default: today
 *   dimension   "query" | "page" | "country" | "device" | "date"
 *                                              default: "date"
 *                — when set to anything other than "date", the response is
 *                grouped by that dimension across the date range, sorted
 *                by clicks DESC. "date" returns one row per day.
 *   limit       1–500                          default: 100
 *
 * Response: `{ rows: [...], dimension, total: { clicks, impressions } }`
 */
type Dim = "date" | "query" | "page" | "country" | "device"

const DEFAULT_FROM_DAYS = 28

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const websiteId = req.params.id
  const dimension = (req.query?.dimension as Dim) || "date"
  if (!isDim(dimension)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `dimension must be one of date, query, page, country, device`
    )
  }
  const limit = clamp(parseInt(String(req.query?.limit ?? "100"), 10) || 100, 1, 500)

  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setDate(defaultFrom.getDate() - (DEFAULT_FROM_DAYS - 1))
  const from = String(req.query?.from || ymd(defaultFrom))
  const to = String(req.query?.to || ymd(today))

  const { binding } = await resolveSearchConsoleBindingForWebsite(
    req.scope,
    websiteId
  )
  if (!binding) {
    return res.status(200).json({
      rows: [],
      dimension,
      total: { clicks: 0, impressions: 0 },
      bound: false,
    })
  }

  const socials = req.scope.resolve(SOCIALS_MODULE) as any
  const [site] = await socials.listGoogleSearchConsoleSites(
    { platform_id: binding.platform_id, site_url: binding.resource_id },
    { take: 1 }
  )
  if (!site) {
    return res.status(200).json({
      rows: [],
      dimension,
      total: { clicks: 0, impressions: 0 },
      bound: true,
      synced: false,
    })
  }

  // Pull every row in the window once. With 5000/day × 28 days = ~140k
  // rows worst case, but typically far less. Aggregating in memory is
  // cheaper than firing a separate group-by query per dimension request.
  const raw = await socials.listGoogleSearchConsoleInsights(
    { site_id: site.id },
    { take: 200_000, order: { date: "ASC" } }
  )
  const inWindow = raw.filter(
    (r: any) => r.date >= from && r.date <= to
  )

  let total = 0
  let totalImpressions = 0
  for (const r of inWindow) {
    total += toNumber(r.clicks)
    totalImpressions += toNumber(r.impressions)
  }

  if (dimension === "date") {
    // Group by date — one row per day. Average position is weighted by
    // impressions; CTR derived from totals.
    const byDate = new Map<
      string,
      {
        date: string
        clicks: number
        impressions: number
        position_num: number
        position_den: number
      }
    >()
    for (const r of inWindow) {
      const slot = byDate.get(r.date) || {
        date: r.date,
        clicks: 0,
        impressions: 0,
        position_num: 0,
        position_den: 0,
      }
      slot.clicks += toNumber(r.clicks)
      slot.impressions += toNumber(r.impressions)
      if (r.position !== null && r.position !== undefined) {
        slot.position_num += (Number(r.position) || 0) * toNumber(r.impressions)
        slot.position_den += toNumber(r.impressions)
      }
      byDate.set(r.date, slot)
    }
    const rows = [...byDate.values()]
      .map((s) => ({
        date: s.date,
        clicks: s.clicks,
        impressions: s.impressions,
        ctr: s.impressions ? s.clicks / s.impressions : null,
        position: s.position_den ? s.position_num / s.position_den : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return res.status(200).json({
      rows,
      dimension,
      total: { clicks: total, impressions: totalImpressions },
      bound: true,
      synced: true,
      window: { from, to },
    })
  }

  // Group by query/page/country/device. Skip rows where the dimension is
  // null — those are anonymized "no query" buckets we don't want to mix.
  const byKey = new Map<
    string,
    {
      key: string
      clicks: number
      impressions: number
      position_num: number
      position_den: number
    }
  >()
  for (const r of inWindow) {
    const value = r[dimension as keyof typeof r] as string | null | undefined
    if (!value) continue
    const slot = byKey.get(value) || {
      key: value,
      clicks: 0,
      impressions: 0,
      position_num: 0,
      position_den: 0,
    }
    slot.clicks += toNumber(r.clicks)
    slot.impressions += toNumber(r.impressions)
    if (r.position !== null && r.position !== undefined) {
      slot.position_num += (Number(r.position) || 0) * toNumber(r.impressions)
      slot.position_den += toNumber(r.impressions)
    }
    byKey.set(value, slot)
  }
  const rows = [...byKey.values()]
    .map((s) => ({
      [dimension]: s.key,
      clicks: s.clicks,
      impressions: s.impressions,
      ctr: s.impressions ? s.clicks / s.impressions : null,
      position: s.position_den ? s.position_num / s.position_den : null,
    }))
    .sort((a: any, b: any) => b.clicks - a.clicks)
    .slice(0, limit)

  res.status(200).json({
    rows,
    dimension,
    total: { clicks: total, impressions: totalImpressions },
    bound: true,
    synced: true,
    window: { from, to },
  })
}

function isDim(s: string): s is Dim {
  return ["date", "query", "page", "country", "device"].includes(s)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function toNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof v === "object" && v && "value" in v) return toNumber((v as any).value)
  return 0
}
