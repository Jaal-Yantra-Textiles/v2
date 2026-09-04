/**
 * GET /admin/email-suppressions — read the suppression ledger (#1339).
 *
 * The ledger had no read surface at all: the only admin route touching it was
 * the write-only `suppress-bounced-subscribers` maintenance job. That opacity is
 * part of why it rotted into a write-only store — nobody could see that it was
 * being populated correctly and consulted nowhere.
 *
 * Returns the rows plus a `by_reason` roll-up, because the first question anyone
 * asks of this table is "how many hard bounces are we carrying".
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { EMAIL_SUPPRESSION_MODULE } from "../../../modules/email_suppression"

/** Max rows per page. Explicit, and echoed in the response, because a silent
 * clamp is how a list route hides most of its data (#1552). */
const MAX_LIMIT = 200

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(EMAIL_SUPPRESSION_MODULE)

  const q = req.query as Record<string, string | undefined>
  const requestedLimit = Number(q.limit ?? 50)
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : 50
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0)

  const filters: Record<string, unknown> = {}
  if (q.email) {
    filters.email = String(q.email).trim().toLowerCase()
  }
  if (q.reason) {
    filters.reason = String(q.reason).trim()
  }

  const [suppressions, count] = await service.listAndCountEmailSuppressions(
    filters,
    { take: limit, skip: offset, order: { created_at: "DESC" } }
  )

  // Roll-up over the WHOLE ledger, not the current page — a per-page count
  // would answer a question nobody asked.
  const all = await service.listEmailSuppressions(filters, {
    select: ["reason"],
    take: null,
  })
  const byReason: Record<string, number> = {}
  for (const row of all ?? []) {
    const reason = (row as any)?.reason ?? "unknown"
    byReason[reason] = (byReason[reason] ?? 0) + 1
  }

  res.json({
    suppressions,
    count,
    offset,
    limit,
    limit_max: MAX_LIMIT,
    by_reason: byReason,
  })
}
