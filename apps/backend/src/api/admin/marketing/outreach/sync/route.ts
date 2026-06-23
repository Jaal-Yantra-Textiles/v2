/**
 * POST /admin/marketing/outreach/sync — reconcile a batch of provider engagement
 * events against the persisted `marketing_outreach` rows (#659 slice 4 / PR-4d).
 *
 * The body carries normalized provider message-events (e.g. relayed from a Resend
 * webhook): each targets a row by `id` or by the provider `external_id`, and the
 * forward-only state machine (`diffOutreachEngagement` → `reconcileOutreachBatch`)
 * advances status + fills engagement timestamps idempotently. A bounce signal sets
 * `bounce_unreliable=true` (flag, never auto-suppress).
 *
 * Same dry-run/apply contract as the ops maintenance jobs: `dry_run` defaults to
 * true and previews the change set without writing; `dry_run=false` persists.
 *
 * No middleware — body is parsed manually with the route validator so the
 * `/admin/marketing` matcher stays off the shared middlewares list (mirrors the
 * sibling outreach routes; undeclared params never 400, #508).
 */

import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { MARKETING_MODULE } from "../../../../../modules/marketing"
import {
  reconcileOutreachBatch,
  summarizeOutreachSync,
  type OutreachSyncEvent,
  type OutreachSyncRow,
} from "../../../../../modules/marketing/outreach-sync-lib"
import { syncOutreachBodySchema } from "../validators"

const JOB_ID = "sync-marketing-outreach-engagement"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const parsed = syncOutreachBodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ message: parsed.error.issues[0]?.message ?? "Invalid body" })
    return
  }
  const { dry_run, events } = parsed.data

  const service = req.scope.resolve(MARKETING_MODULE) as any

  // Load only the rows the events can address (by id or external_id).
  const ids = Array.from(
    new Set(events.map((e) => e.id).filter((v): v is string => !!v))
  )
  const exts = Array.from(
    new Set(events.map((e) => e.external_id).filter((v): v is string => !!v))
  )

  const byId = new Map<string, OutreachSyncRow>()
  if (ids.length) {
    const rows = (await service.listMarketingOutreaches({ id: ids })) as any[]
    for (const r of rows ?? []) byId.set(r.id, r)
  }
  if (exts.length) {
    const rows = (await service.listMarketingOutreaches({
      external_id: exts,
    })) as any[]
    for (const r of rows ?? []) byId.set(r.id, r)
  }
  const rows = Array.from(byId.values())

  const result = reconcileOutreachBatch(rows, events as OutreachSyncEvent[])

  if (!dry_run && result.items.length > 0) {
    for (const item of result.items) {
      await service.updateMarketingOutreaches({ id: item.id, ...item.patch })
    }
  }

  res.status(200).json({
    job_id: JOB_ID,
    dry_run,
    applied: !dry_run && result.items.length > 0,
    summary: summarizeOutreachSync({
      dry_run,
      eventsReceived: events.length,
      matchedRows: result.matchedRowIds.length,
      changedRows: result.items.length,
      totalChanges: result.changes.length,
    }),
    changes: result.changes,
    matched: result.matchedRowIds.length,
    unmatched_events: result.unmatchedEvents,
  })
}
