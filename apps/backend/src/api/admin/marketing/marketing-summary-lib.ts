/**
 * marketing-summary-lib.ts — pure composer for the daily marketing summary
 * (#659, report §12.6). Turns the already-built `HeadlineResponse` (from
 * `marketing-read-lib.ts`) into a short WhatsApp-friendly text block: the One-Goal
 * headline (GMV) + the secondary KPI strip + a staleness warning.
 *
 * Kept free of Medusa/HTTP/WhatsApp imports so it's unit-testable without booting
 * the app. The job (registry.ts) builds the HeadlineResponse and sends the text
 * through the EXISTING WhatsApp channel — this lib only formats.
 */

import type { HeadlineMetric, HeadlineResponse } from "./marketing-read-lib"

export type DailySummary = {
  text: string
  /** false when there are no snapshots yet (nothing meaningful to send). */
  hasData: boolean
  stale: boolean
}

/** Pure: human-format a metric value by unit (mirrors the email formatter). */
export function formatSummaryValue(
  value: number,
  unit?: string | null
): string {
  const u = (unit || "").toLowerCase()
  if (u === "inr") return "₹" + Math.round(value).toLocaleString("en-IN")
  if (u === "usd") return "$" + Math.round(value).toLocaleString("en-US")
  if (u === "percent") return `${round1(value)}%`
  if (u === "ratio") return `${round1(value * 100)}%`
  if (u === "count") return Math.round(value).toLocaleString("en-IN")
  return String(value)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Pure: a "▲ +4.2% DoD" / "▼ -1.0% DoD" trend tag, or "" when no delta. */
export function formatDelta(dod: number | null | undefined): string {
  if (dod == null || !Number.isFinite(dod)) return ""
  const arrow = dod > 0 ? "▲" : dod < 0 ? "▼" : "▬"
  const sign = dod > 0 ? "+" : ""
  return ` (${arrow} ${sign}${round1(dod)}% DoD)`
}

/** Pretty-print a metric_key like "platform_net_gmv" → "Platform Net Gmv". */
export function humanizeMetricKey(key: string): string {
  return (key || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function metricLine(m: HeadlineMetric, bullet = false): string {
  const label = humanizeMetricKey(m.metric_key)
  const val = formatSummaryValue(m.value, m.unit)
  const delta = formatDelta(m.dod_delta)
  return `${bullet ? "• " : ""}${label}: ${val}${delta}`
}

/**
 * Pure: compose the daily summary text from a HeadlineResponse.
 *
 * @param headline  the SWR headline blob (headline + strip + stale)
 * @param opts.dateLabel  e.g. "2026-06-23" (IST) — included in the title
 * @param opts.businessName  default "JYT"
 */
export function buildDailyMarketingSummary(
  headline: HeadlineResponse,
  opts: { dateLabel: string; businessName?: string }
): DailySummary {
  const name = opts.businessName || "JYT"
  const title = `📊 ${name} Marketing — ${opts.dateLabel}`
  const hasData = !!headline.headline || headline.strip.length > 0

  if (!hasData) {
    return {
      text: `${title}\n\nNo metrics captured yet — nothing to report.`,
      hasData: false,
      stale: headline.stale,
    }
  }

  const lines: string[] = [title, ""]

  if (headline.headline) {
    lines.push(`🎯 ${metricLine(headline.headline)}`)
  } else {
    lines.push("🎯 One-Goal metric not captured yet.")
  }

  if (headline.strip.length > 0) {
    lines.push("", "Other metrics:")
    for (const m of headline.strip) lines.push(metricLine(m, true))
  }

  if (headline.stale) {
    lines.push("", "⚠️ Data looks stale — the daily refresh may have missed a run.")
  }

  return { text: lines.join("\n"), hasData: true, stale: headline.stale }
}
