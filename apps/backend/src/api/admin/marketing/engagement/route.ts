/**
 * GET /admin/marketing/engagement — read the email-engagement ledger for the
 * admin Marketing → Engagement view (#1017).
 *
 * The engagement counters + `engagement_status` are computed (webhook ingestion
 * + the recompute job) but nothing ever exposed them to the UI. This read route
 * closes that gap: it lists rows filtered by status / email search, paginated at
 * the DB, plus a global per-status summary for the KPI strip.
 *
 * No middleware: the query is parsed manually with a local schema so the
 * `/admin/marketing` matcher stays off the shared middlewares list and undeclared
 * query params never 400 (mirrors the sibling outreach read route, #508).
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { z } from "zod"

import { EMAIL_ENGAGEMENT_MODULE } from "../../../../modules/email_engagement"

const ENGAGEMENT_STATUSES = [
  "engaged",
  "cooling",
  "dormant",
  "never_opened",
  "unknown",
] as const

const listEngagementQuerySchema = z.object({
  status: z.enum(ENGAGEMENT_STATUSES).optional(),
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const parsed = listEngagementQuerySchema.safeParse(req.query ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ message: parsed.error.issues[0]?.message ?? "Invalid query" })
    return
  }
  const { status, q, limit, offset } = parsed.data

  const service = req.scope.resolve(EMAIL_ENGAGEMENT_MODULE) as any

  const filters: Record<string, unknown> = {}
  if (status) filters.engagement_status = status
  if (q) filters.q = q // `email` is a searchable field on the model

  const [engagement, count] = await service.listAndCountEmailEngagements(
    filters,
    {
      take: limit,
      skip: offset,
      // Most-recently-active first; nulls sink to the bottom.
      order: { last_event_at: "DESC" },
    }
  )

  // Global per-status distribution for the KPI strip (ignores the current
  // status/q filter so the totals stay stable as the user drills in).
  const summary: Record<string, number> = {}
  let total = 0
  for (const s of ENGAGEMENT_STATUSES) {
    const [, c] = await service.listAndCountEmailEngagements(
      { engagement_status: s },
      { take: 1 }
    )
    summary[s] = c
    total += c
  }

  res.status(200).json({
    engagement,
    count,
    offset,
    limit,
    summary: { ...summary, total },
  })
}
