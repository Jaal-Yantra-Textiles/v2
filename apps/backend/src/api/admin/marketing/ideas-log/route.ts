/**
 * @file Admin read route for the marketing tactical-ideas log (#659 slice 2, PR-5).
 * @description Read-only listing + roll-up of `marketing_ideas_log` rows so an
 * operator can audit what the daily AI-VP ideas email generated, whether the
 * hallucination guard passed, and whether it was actually sent. Mirrors the
 * money-rollup envelope of `src/api/admin/partners/[id]/fees/route.ts`
 * (spec 02 §7). No writes here — rows are produced by the generate/send
 * workflows; this is purely the audit surface.
 * @module API/Admin/Marketing/IdeasLog
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { MARKETING_MODULE } from "../../../../modules/marketing"
import {
  parseBoolFilter,
  parseNonNegativeInt,
  sortIdeasLogNewestFirst,
  summarizeIdeasLog,
  type IdeasLogRowLike,
} from "./summarize-ideas-log"

/**
 * GET /admin/marketing/ideas-log
 *
 * Lists recent `marketing_ideas_log` rows (newest first) plus a roll-up summary
 * (total, guard pass/fail, sent/not-sent, regenerated).
 *
 * Query:
 *   - `guard_passed` (`true|false|1|0`) — filter to guard-passed / guard-failed rows.
 *   - `sent` (`true|false|1|0`) — filter to sent / unsent rows.
 *   - `offset` / `limit` — pagination (defaults 0 / 50).
 *
 * The summary is computed over the FULL filtered set (not the paginated page)
 * so totals stay correct regardless of offset/limit (the page-vs-set bug, #484).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = parseNonNegativeInt(req.query.offset, 0)
  const limit = parseNonNegativeInt(req.query.limit, 50) || 50

  const guardPassed = parseBoolFilter(req.query.guard_passed)
  const sent = parseBoolFilter(req.query.sent)

  const filters: Record<string, unknown> = {}
  if (guardPassed !== undefined) {
    filters.guard_passed = guardPassed
  }
  if (sent !== undefined) {
    filters.sent = sent
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const marketing: any = req.scope.resolve(MARKETING_MODULE)

  // List the full filtered set once: the summary must be over the whole set,
  // and the table is one-row-per-day so it stays small. Sort + paginate in-app
  // (matches the documented fees-route reference).
  const all: IdeasLogRowLike[] =
    (await marketing.listMarketingIdeasLogs(filters)) || []

  const sorted = sortIdeasLogNewestFirst(all)
  const summary = summarizeIdeasLog(sorted)
  const ideas_log = sorted.slice(offset, offset + limit)

  return res.status(200).json({
    ideas_log,
    count: sorted.length,
    offset,
    limit,
    summary,
  })
}
