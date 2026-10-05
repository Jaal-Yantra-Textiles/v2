import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { releaseRunsAwaitingRun } from "../workflows/production-runs/lib/release-dependent-runs"

/**
 * A finished stage releases the stage that was waiting for it (#1529, #2306).
 *
 * The run-to-run twin of `inventory-order-delivered-release-runs`. Hung off
 * `production_run.completed`, which every completion path emits — the
 * partner's complete and the admin complete (both through
 * `completeProductionRunWorkflow`) and the all-tasks-done cascade in
 * `production-run-task-updated` — so a stage finishing by any route hands over
 * the same way.
 *
 * 🔴 It looks across the WHOLE board, not only under the completed run's
 * parent. A wait can now be attached after approval, and the stage it points
 * at is often under another parent (a later-added stage for the same pieces).
 * See `findRunsAwaitingRun`.
 *
 * The status is re-read from the run rather than trusted from the event: the
 * gate in `resolveUnmetDependencies` reads the upstream's stored status, so a
 * stray event for a run that is not actually completed releases nothing.
 */
export default async function productionRunCompletedReleaseRuns({
  event,
  container,
}: SubscriberArgs<{ id?: string; production_run_id?: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const runId = event.data?.production_run_id || event.data?.id
  if (!runId) {
    return
  }

  try {
    await releaseRunsAwaitingRun(container, String(runId))
  } catch (e: any) {
    // The completion is already recorded; failing here must not make it look
    // otherwise. A stalled stage stays recoverable by hand.
    logger.error(
      `[production-run-completed] failed to release runs waiting on ${runId}: ${e?.message || String(e)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "production_run.completed",
}
