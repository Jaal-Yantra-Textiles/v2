import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { sendProductionRunToProductionWorkflow } from "../send-production-run-to-production"
import { selectDispatchInput } from "./dispatch-selection"
import {
  cleanIds,
  hasUnmet,
  describeUnmet,
  resolveUnmetDependencies,
} from "./run-dependencies"

/**
 * Advancing a chain one hop (#1529).
 *
 * Something upstream just became met — a partner's run completed, or the goods
 * a partner was waiting on were delivered. Any approved run that was waiting on
 * it, and whose OTHER dependencies are also met, is now dispatchable.
 *
 * Both callers land here so a chain advances identically whichever kind of edge
 * released it.
 */

export type ReleaseOutcome =
  | { run_id: string; result: "dispatched" }
  | { run_id: string; result: "waiting"; reason: string }
  | { run_id: string; result: "no_templates" }
  | { run_id: string; result: "failed"; message: string }

/** Only an approved run is a candidate; anything else is already in flight. */
const RELEASABLE_STATUS = "approved"

export const releaseRunIfReady = async (
  container: any,
  run: any
): Promise<ReleaseOutcome> => {
  const runId = String(run?.id)

  const unmet = await resolveUnmetDependencies(container, run)
  if (hasUnmet(unmet)) {
    return { run_id: runId, result: "waiting", reason: describeUnmet(unmet) }
  }

  const selection = selectDispatchInput(run)
  if (!selection) {
    return { run_id: runId, result: "no_templates" }
  }

  try {
    await sendProductionRunToProductionWorkflow(container).run({
      input: { production_run_id: runId, ...selection },
    })
    return { run_id: runId, result: "dispatched" }
  } catch (e: any) {
    return {
      run_id: runId,
      result: "failed",
      message: String(e?.message || e || "Dispatch failed"),
    }
  }
}

/**
 * Runs waiting on a specific inventory order.
 *
 * Filtered in memory rather than by a jsonb containment query: the column holds
 * a JSON array and the module service has no containment operator, so the
 * choice is this or raw SQL against another module's table. The candidate set
 * is approved-but-undispatched runs — a queue that is small by construction,
 * because a run leaves it the moment its materials arrive.
 */
export const findRunsAwaitingInventoryOrder = async (
  container: any,
  inventoryOrderId: string
): Promise<any[]> => {
  const productionRunService: ProductionRunService = container.resolve(
    PRODUCTION_RUNS_MODULE
  )

  const candidates = await productionRunService.listProductionRuns({
    status: RELEASABLE_STATUS,
  } as any)

  return (candidates || []).filter((run: any) =>
    cleanIds(run?.depends_on_inventory_order_ids).includes(
      String(inventoryOrderId)
    )
  )
}

/**
 * Release every run that was waiting on `inventoryOrderId`, logging what
 * happened to each.
 *
 * A run left `waiting` here is NOT an error — it has another upstream edge
 * still outstanding and will be reconsidered when that one lands. A run with no
 * templates recorded is deliberate too: it was approved to be dispatched by
 * hand. Only `failed` needs a human, and it says why.
 */
export const releaseRunsAwaitingInventoryOrder = async (
  container: any,
  inventoryOrderId: string
): Promise<ReleaseOutcome[]> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const waiting = await findRunsAwaitingInventoryOrder(
    container,
    inventoryOrderId
  )

  const outcomes: ReleaseOutcome[] = []

  for (const run of waiting) {
    const outcome = await releaseRunIfReady(container, run)
    outcomes.push(outcome)

    switch (outcome.result) {
      case "dispatched":
        logger.info(
          `[inventory-order-delivered] released run ${outcome.run_id} — goods from ${inventoryOrderId} delivered`
        )
        break
      case "waiting":
        logger.info(
          `[inventory-order-delivered] run ${outcome.run_id} still waiting for ${outcome.reason}`
        )
        break
      case "no_templates":
        logger.info(
          `[inventory-order-delivered] run ${outcome.run_id} is ready but no templates were recorded — dispatch by hand`
        )
        break
      case "failed":
        logger.error(
          `[inventory-order-delivered] run ${outcome.run_id} failed to dispatch: ${outcome.message}`
        )
        break
    }
  }

  return outcomes
}
