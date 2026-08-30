import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  findRunsDueForShortClose,
  shortCloseProductionRun,
  SHORT_CLOSE_AFTER_DAYS,
} from "../workflows/production-runs/lib/short-close-production-run"

/**
 * The 30-day counter (#1596).
 *
 * A run ordered for 9 and completed at 7 keeps 2 units billable, because the
 * write guard's ceiling is the ORDERED quantity and that number cannot tell
 * "not made yet" from "never will be made". Left alone those tails never close:
 * nobody goes looking for a two-unit remainder on a run that finished months
 * ago, and the screens keep offering it.
 *
 * The founder's decision (2026-08-30): close it explicitly, and on a counter
 * "after seeing what's produced after a period of time". This is the counter —
 * 30 days of silence after the last sign of production, then the ceiling
 * becomes what was actually made.
 *
 * ## Why this one WRITES, when the neighbouring watchers do not
 *
 * `check-inventory-level-divergence` refuses to resolve anything because
 * neither side of its comparison is authoritative — picking a winner is a
 * judgement about what really happened. Here there is no such ambiguity: the
 * produced quantity is a figure the partner reported and an admin can correct,
 * and 30 days of silence after it is the statement. The decision is also
 * cheaply reversible, which the divergence case is not.
 *
 * 🔴 The safeguards are in `shortCloseDecision`, and they are the point:
 * a run with no output figure, or one reporting ZERO produced, is never closed
 * by the counter — that would wipe a claim on the strength of a number nobody
 * confirmed. A run whose last output CORRECTION is recent is not closed either,
 * however long ago it completed; the counter waits for the evidence it exists
 * to see. And an upward correction on a closed run reopens it automatically.
 *
 * ⚠️ Nothing is clawed back. A run legitimately billed to 7 and then closed at
 * 4 keeps those 7 — `billable_remaining` clamps at zero and the write guard
 * refuses anything further. The log names those runs so a human can look.
 */
export default async function shortCloseStaleProductionRuns(
  container: MedusaContainer
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const { due, scanned, skipped } = await findRunsDueForShortClose(container)

    /**
     * ⚠️ The denominator and the skip reasons are logged on EVERY run. A sweep
     * that closed nothing because there was nothing to close and one that
     * closed nothing because it could not read a single run print identical
     * lines otherwise — the shape of #1208's "success" on 42 broken migrations.
     */
    logger.info(
      `[short-close-runs] scanned ${scanned} completed run(s); ${due.length} due after ${SHORT_CLOSE_AFTER_DAYS}d; skipped ${JSON.stringify(skipped)}`
    )

    if (!due.length) {
      return
    }

    let closed = 0
    const refused: string[] = []

    for (const run of due) {
      try {
        const outcome = await shortCloseProductionRun(container, {
          run_id: String(run.id),
          actor_id: "system",
          actor_type: "system",
          reason: `No further output recorded for ${SHORT_CLOSE_AFTER_DAYS} days`,
        })
        if (outcome.closed) {
          closed += 1
        } else {
          refused.push(`${run.id}:${outcome.reason}`)
        }
      } catch (e: any) {
        // One bad run must not stop the sweep — and must not vanish either.
        refused.push(`${run.id}:error(${e?.message ?? "unknown"})`)
      }
    }

    logger.info(
      `[short-close-runs] closed ${closed} of ${due.length}` +
        (refused.length ? `; not closed: ${refused.join(", ")}` : "")
    )
  } catch (e: any) {
    logger.error(`[short-close-runs] Error: ${e?.message}`)
  }
}

export const config = {
  name: "short-close-stale-production-runs",
  // Daily, 04:00 UTC — before the divergence watcher, and well outside the
  // window anyone is editing runs.
  schedule: "0 4 * * *",
}
