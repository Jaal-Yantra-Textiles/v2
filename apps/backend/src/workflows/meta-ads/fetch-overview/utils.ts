import type { InsightRow, AggregateTotals, BreakdownGroup } from "./types"

export const parseNumber = (val: unknown): number => {
  if (val === null || val === undefined) return 0
  if (typeof val === "number") return Number.isFinite(val) ? val : 0
  if (typeof val === "bigint") return Number(val)
  if (typeof val === "string") {
    const n = Number(val)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof val === "object") {
    const maybe = val as any
    if (maybe?.value !== undefined && maybe?.value !== null) return parseNumber(maybe.value)
    if (typeof maybe?.toString === "function") {
      const n = Number(String(maybe.toString()))
      return Number.isFinite(n) ? n : 0
    }
  }
  return 0
}

export const aggregateTotals = (rows: InsightRow[]): AggregateTotals => {
  let impressions = 0, reach = 0, clicks = 0, spend = 0
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

export const aggregateActions = (rows: InsightRow[]): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    const actions = (row.actions as Array<{ action_type?: string; value?: string | number }>) || []
    for (const action of actions) {
      const type = String(action.action_type || "unknown")
      totals[type] = (totals[type] || 0) + parseNumber(action.value)
    }
  }
  return totals
}

export const groupByBreakdown = (
  rows: InsightRow[],
  breakdownKeys: string[]
): BreakdownGroup[] => {
  const groups = new Map<string, { key: Record<string, string>; rows: InsightRow[] }>()

  for (const row of rows) {
    const keyObj: Record<string, string> = {}
    for (const key of breakdownKeys) {
      const rawVal = row[key]
      keyObj[key] = rawVal === null || rawVal === undefined ? "unknown" : String(rawVal)
    }
    const stableKey = breakdownKeys.map((k) => `${k}:${keyObj[k]}`).join("|")
    if (!groups.has(stableKey)) groups.set(stableKey, { key: keyObj, rows: [] })
    groups.get(stableKey)!.rows.push(row)
  }

  return [...groups.values()]
    .map((g) => ({ key: g.key, totals: aggregateTotals(g.rows), results: aggregateActions(g.rows) }))
    .sort((a, b) => b.totals.spend - a.totals.spend)
}

export const getBreakdownValue = (row: InsightRow, key: string): string | null => {
  const raw = row[key]
  if (raw === null || raw === undefined || raw === "") return null
  return String(raw)
}

export const parseDate = (val: unknown): Date => {
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

export const getPresetDays = (preset?: string): number | null => {
  switch (preset) {
    case "last_7d": return 7
    case "last_14d": return 14
    case "last_30d": return 30
    case "last_90d": return 90
    case "maximum": return null
    default: return 30
  }
}

export const hasAnyBreakdown = (row: InsightRow): boolean =>
  Boolean(
    row.age || row.gender || row.country || row.region ||
    row.publisher_platform || row.platform_position || row.device_platform
  )
