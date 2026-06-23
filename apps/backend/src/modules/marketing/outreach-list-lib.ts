/**
 * Pure list/filter/paginate for `marketing_outreach` (#659 slice 4 / PR-4b).
 *
 * Honours the `q` free-text search server-side and filters the FULL SET before
 * paginating, so `count` is the total number of matched rows — NOT the per-page
 * count. This is the recurring partner-search regression (memory #484: several
 * `/partners/*` routes silently dropped `q`, and others paginated before filtering
 * → wrong totals). Kept dependency-free so it's unit-testable without the DB.
 *
 * Field names mirror the SHIPPED model
 * (`src/modules/marketing/models/marketing-outreach.ts`).
 */

import type { OutreachStatus } from "./diff-outreach-engagement"

export type OutreachChannel = "email" | "whatsapp" | "manual"

/** Subset of `marketing_outreach` columns the list view filters/searches on. */
export type OutreachListRow = {
  id: string
  recipient_email?: string | null
  recipient_name?: string | null
  company?: string | null
  campaign?: string | null
  status?: OutreachStatus | null
  channel?: OutreachChannel | null
}

export type OutreachListOptions = {
  /** free-text — matched (case-insensitive substring) across recipient/company/campaign */
  q?: string | null
  status?: OutreachStatus | null
  campaign?: string | null
  channel?: OutreachChannel | null
  offset?: number | null
  limit?: number | null
}

export type OutreachListResult<T> = {
  items: T[]
  /** total rows matching the filters BEFORE pagination */
  count: number
  offset: number
  limit: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function clampOffset(v: number | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function clampLimit(v: number | null | undefined): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_LIMIT
  }
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function matchesQuery(row: OutreachListRow, needle: string): boolean {
  const haystack = [
    row.recipient_email,
    row.recipient_name,
    row.company,
    row.campaign,
  ]
  return haystack.some(
    (field) => typeof field === "string" && field.toLowerCase().includes(needle)
  )
}

/**
 * Filter `rows` by the given options, then paginate. Input order is preserved
 * (callers sort newest-first before calling). Returns matched `items` for the
 * requested window plus the total matched `count`.
 */
export function filterAndPaginateOutreach<T extends OutreachListRow>(
  rows: T[],
  opts: OutreachListOptions = {}
): OutreachListResult<T> {
  const offset = clampOffset(opts.offset)
  const limit = clampLimit(opts.limit)

  const q = typeof opts.q === "string" ? opts.q.trim().toLowerCase() : ""
  const status = opts.status ?? null
  const campaign = opts.campaign ?? null
  const channel = opts.channel ?? null

  const matched = (rows ?? []).filter((row) => {
    if (status && row.status !== status) {
      return false
    }
    if (channel && row.channel !== channel) {
      return false
    }
    if (campaign && row.campaign !== campaign) {
      return false
    }
    if (q && !matchesQuery(row, q)) {
      return false
    }
    return true
  })

  return {
    items: matched.slice(offset, offset + limit),
    count: matched.length,
    offset,
    limit,
  }
}
