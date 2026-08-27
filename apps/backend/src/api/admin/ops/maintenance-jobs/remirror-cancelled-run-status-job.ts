import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { mirrorRunStatusToUnifiedOrder } from "../../../../workflows/production-runs/dual-write-unified-run-order"
import { resolveUnifiedOrderIdByLink } from "../../../../workflows/inventory_orders/dual-write-unified-order"
import {
  decideRunStatusRemirrors,
  summarizeRemirrorDecisions,
  type MirrorCandidate,
} from "./lib/cancelled-run-status-remirror"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — re-mirror terminal runs whose order still reads as live work.
 *
 * ## The gap this closes
 *
 * `mirrorRunStatusToUnifiedOrder` fires on a status CHANGE. #1577 fixed the
 * derivation so a cancel writes `partner_status = "cancelled"` — but it fixed
 * the FUTURE. Runs cancelled before that deploy transitioned while the
 * derivation returned `undefined`; the mirror writes only truthy values, so
 * the sidecar kept whatever it last said. Prod carries roughly 40 of them and
 * nothing will ever revisit them: no event fires on a run that is already
 * terminal.
 *
 * ## 🔑 It is an instrument before it is a repair
 *
 * The mirror swallows its own failures — `catch { logger.warn(...) }` — which
 * is exactly why an admin cancel could return 200 while the database rejected
 * its status write. A repair built on that call alone would report "40
 * repaired" whether or not one row moved.
 *
 * So every apply RE-READS the sidecar afterwards and reports the value it
 * actually finds:
 *
 *   - moved to the expected value  → repaired
 *   - unchanged, or moved elsewhere → an ERROR entry naming both values
 *
 * That readback is what can answer "did the write land?" for a boundary that
 * refuses to tell you. It is also the check that would have caught the
 * `unified_order_status` constraint never widening to accept `cancelled`.
 *
 * ## What it deliberately does not do
 *
 * 🔑 It never predicts "cancelled". Expectations come from the mirror's OWN
 * helpers, so a collated order with one cancelled run among four in flight
 * correctly stays `in_progress`. A second implementation of that rule is how
 * the two drift apart, and the drift is the bug being repaired.
 *
 * 🔑 A run whose status derives no partner_status is reported `undeterminable`,
 * never `already_correct`. The mirror would write nothing for it, so the job
 * cannot vouch for the row — and calling an unjudgeable row healthy is how the
 * original bug hid for months.
 */

const paramsSchema = z.object({
  /** Which run status to sweep. Default "cancelled" — the #1577 gap. */
  status: z
    .enum(["cancelled", "completed", "in_progress", "sent_to_partner"])
    .optional(),
  /** Cap the number re-mirrored in one pass. Default 100. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /** Only consider this run — for verifying the decision on one row. */
  production_run_id: z.string().min(1).optional(),
  /**
   * Report every bucket, not just the stale ones. Off by default because a
   * healthy prod would otherwise return hundreds of no-op rows.
   */
  verbose: z.coerce.boolean().optional(),
})

const DEFAULT_STATUS = "cancelled"
const DEFAULT_LIMIT = 100

/** Current sidecar + core status for an order, read fresh. */
const readOrderStatus = async (
  query: any,
  orderId: string
): Promise<{
  partner_status?: string | null
  core_status?: string | null
  superseded: boolean
  linked_runs: any[]
}> => {
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "metadata",
      "unified_order_status.partner_status",
      "production_runs.id",
      "production_runs.status",
      "production_runs.accepted_at",
      "production_runs.started_at",
      "production_runs.finished_at",
    ],
    filters: { id: orderId },
  })
  const row = data?.[0]
  return {
    partner_status: row?.unified_order_status?.partner_status ?? null,
    core_status: row?.status ?? null,
    superseded: Boolean(row?.metadata?.superseded_by_run_ids),
    linked_runs: (row?.production_runs ?? []).filter(Boolean),
  }
}

export const remirrorCancelledRunStatusJob: MaintenanceJob = {
  id: "remirror-cancelled-run-status",
  label: "Re-mirror terminal runs whose unified order still reads as live work",
  description:
    "Finds production runs in a terminal state (default cancelled) whose unified order's partner_status disagrees with what the mirror would derive today, re-runs the mirror, and RE-READS the sidecar to report the value it actually finds. #1577 fixed the derivation going forward; runs cancelled before that deploy were never revisited, because no event fires on a run that is already terminal. Expectations use the mirror's own aggregation helpers, so a collated order with one cancelled run among four in flight correctly stays in_progress. A row that does not move is reported as an ERROR, never a warning — the mirror swallows its own failures, which is how an admin cancel could return 200 while the database rejected the write. Dry-run lists every disagreement with both values, and counts every bucket it did not select.",
  params: [
    {
      name: "status",
      type: "string",
      required: false,
      description:
        "Run status to sweep: cancelled (default), completed, in_progress or sent_to_partner. Only 'cancelled' is a known gap; the others are for verifying the instrument against rows that should already be correct.",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Maximum runs to re-mirror in one pass. Default 100.",
    },
    {
      name: "production_run_id",
      type: "string",
      required: false,
      description:
        "Consider only this run. Useful to check one row's decision before sweeping.",
    },
    {
      name: "verbose",
      type: "boolean",
      required: false,
      description:
        "List every run examined, not just the stale ones. Counts are always reported either way.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid params: ${parsed.error.issues.map((i) => i.message).join(", ")}`
      )
    }

    const status = parsed.data.status ?? DEFAULT_STATUS
    const limit = parsed.data.limit ?? DEFAULT_LIMIT
    const onlyId = parsed.data.production_run_id
    const verbose = parsed.data.verbose === true

    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: [
        "id",
        "status",
        "accepted_at",
        "started_at",
        "finished_at",
      ],
      filters: onlyId ? { id: onlyId } : { status },
    })

    const candidates: MirrorCandidate[] = []
    for (const run of (runs || []) as any[]) {
      const unifiedOrderId = await resolveUnifiedOrderIdByLink(
        container as any,
        "production_runs",
        String(run.id)
      )
      if (!unifiedOrderId) {
        candidates.push({
          run_id: String(run.id),
          run,
          unified_order_id: null,
          linked_runs: [run],
        })
        continue
      }
      const order = await readOrderStatus(query, unifiedOrderId)
      candidates.push({
        run_id: String(run.id),
        run,
        unified_order_id: unifiedOrderId,
        superseded: order.superseded,
        current_partner_status: order.partner_status,
        // Fall back to the run itself so a link-less graph read never makes a
        // single-run order look collated (or empty, which aggregates to
        // undefined and would read as "undeterminable").
        linked_runs: order.linked_runs.length ? order.linked_runs : [run],
      })
    }

    const decisions = decideRunStatusRemirrors(candidates)
    const counts = summarizeRemirrorDecisions(decisions)
    const stale = decisions.filter((d) => d.verdict === "stale")
    const selected = stale.slice(0, limit)
    const dropped = stale.length - selected.length

    const reported = verbose ? decisions : selected
    const changes: MaintenanceChange[] = reported.map((d) => ({
      entity: "order",
      id: d.unified_order_id ?? d.run_id,
      field: "partner_status",
      before: d.current_partner_status ?? null,
      after: d.expected_partner_status ?? null,
      note: `run ${d.run_id} (${status}) — ${d.verdict}: ${d.note}`,
    }))

    // 🔑 Every bucket, every time. "12 stale" alone reads as "and the other 28
    // are fine" when one of them may be a row nothing can judge.
    const bucketLine = `examined ${decisions.length}: ${counts.stale} stale, ${counts.already_correct} already correct, ${counts.undeterminable} undeterminable, ${counts.superseded} superseded, ${counts.no_unified_order} unlinked`

    if (dry_run) {
      return {
        job_id: "remirror-cancelled-run-status",
        dry_run: true,
        applied: false,
        summary: `${bucketLine}; would re-mirror ${selected.length}${dropped ? ` (${dropped} beyond the limit of ${limit})` : ""}.`,
        changes,
      }
    }

    const errors: Array<{ id: string; message: string }> = []
    let repaired = 0

    for (const decision of selected) {
      try {
        await mirrorRunStatusToUnifiedOrder(container as any, decision.run_id)

        // 🔴 The readback IS the job. The call above returns `{ linked: false,
        // error }` on failure and logs a warning — trusting it would report a
        // repair that never happened.
        const after = await readOrderStatus(query, decision.unified_order_id!)
        const landed = after.partner_status ?? null

        if (landed === decision.expected_partner_status) {
          repaired++
          continue
        }
        errors.push({
          id: decision.run_id,
          message:
            landed === (decision.current_partner_status ?? null)
              ? `mirror reported no error but partner_status is still "${landed ?? "(unset)"}" — expected "${decision.expected_partner_status}". The write did not land.`
              : `partner_status moved to "${landed ?? "(unset)"}", not the expected "${decision.expected_partner_status}".`,
        })
      } catch (e: any) {
        errors.push({ id: decision.run_id, message: e?.message || String(e) })
      }
    }

    return {
      job_id: "remirror-cancelled-run-status",
      dry_run: false,
      applied: repaired > 0,
      summary: `${bucketLine}; re-mirrored ${repaired} of ${selected.length}${dropped ? ` (${dropped} beyond the limit of ${limit})` : ""}${errors.length ? `; ${errors.length} did NOT land — see errors` : ""}.`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
