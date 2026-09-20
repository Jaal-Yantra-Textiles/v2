import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"
import { sendProductionRunToProductionWorkflow } from "../send-production-run-to-production"
import { selectDispatchInput } from "./dispatch-selection"
import { notifyDispatchByHand } from "./notify-dispatch-by-hand"
import { PRODUCTION_POLICY_MODULE } from "../../../modules/production_policy"
import type ProductionPolicyService from "../../../modules/production_policy/service"
import { resolveDispatchDefault } from "../../../modules/production_policy/policy-config"
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
  /**
   * `via` is present ONLY when a policy default chose the templates because no
   * approval had. Its ABSENCE is the ordinary case — a human chose — which
   * keeps the outcome shape byte-identical for every existing caller, and makes
   * the field mean exactly one thing when it does appear: nobody picked this.
   */
  | { run_id: string; result: "dispatched"; via?: "policy_default" }
  | { run_id: string; result: "waiting"; reason: string }
  | { run_id: string; result: "no_templates" }
  | { run_id: string; result: "failed"; message: string }

/** Only an approved run is a candidate; anything else is already in flight. */
const RELEASABLE_STATUS = "approved"

/**
 * The standing answer for this kind of job, or null.
 *
 * Reads the DESIGN for `product_type` rather than the run: the run carries
 * `product_id`/`variant_id`, and its snapshot's `design` block holds name and
 * status but not the type. A run whose design cannot be read simply has no
 * product_type — it can still match a rule keyed on `run_type` alone.
 *
 * ⚠️ Never throws. This is the last step before a partner is messaged; a policy
 * read that fails must leave the run un-dispatched and tellable, not take the
 * caller down with it.
 */
const resolveDispatchDefaultForRun = async (
  container: any,
  run: any
): Promise<string[] | null> => {
  try {
    const policyService: ProductionPolicyService = container.resolve(
      PRODUCTION_POLICY_MODULE
    )
    const config = await policyService.getPolicyConfig()

    let productType: string | null = null
    if (run?.design_id) {
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: designs = [] } = await query
        .graph({
          entity: "designs",
          filters: { id: String(run.design_id) },
          fields: ["id", "product_type"],
        })
        .catch(() => ({ data: [] }))
      productType = (designs as any[])[0]?.product_type ?? null
    }

    return resolveDispatchDefault(config?.dispatch_defaults, {
      run_type: run?.run_type ?? null,
      product_type: productType,
    })
  } catch {
    return null
  }
}

export const releaseRunIfReady = async (
  container: any,
  run: any
): Promise<ReleaseOutcome> => {
  const runId = String(run?.id)

  const unmet = await resolveUnmetDependencies(container, run)
  if (hasUnmet(unmet)) {
    return { run_id: runId, result: "waiting", reason: describeUnmet(unmet) }
  }

  /*
   * 🔴 THE FALLBACK LIVES HERE AND NOWHERE ELSE.
   *
   * `selectDispatchInput` returning null MEANS "dispatch later, by hand", and
   * `auto-dispatch-approved-children` depends on that meaning — it calls such a
   * run `skipped`, "nothing to dispatch, not a failure". Teaching the selector
   * itself to fall back would change what null means everywhere: on prod
   * 2026-09-20, 8 of 9 approved runs carried no selection, and they would stop
   * being parked and start messaging partners for work nobody released.
   *
   * This branch is narrower by construction. Everything upstream is already
   * met — the cloth is demonstrably here — and the only question left is what
   * to dispatch with. That is the one place an operator's standing answer is
   * better than a log line no one reads (#2202).
   */
  let selection = selectDispatchInput(run)
  let byDefault = false

  if (!selection) {
    const fallback = await resolveDispatchDefaultForRun(container, run)
    if (!fallback) {
      return { run_id: runId, result: "no_templates" }
    }
    selection = { template_ids: fallback }
    byDefault = true
  }

  try {
    await sendProductionRunToProductionWorkflow(container).run({
      input: { production_run_id: runId, ...selection },
    })
    return byDefault
      ? { run_id: runId, result: "dispatched" as const, via: "policy_default" as const }
      : { run_id: runId, result: "dispatched" as const }
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
 * still outstanding and will be reconsidered when that one lands.
 *
 * 🔴 `no_templates` IS NOT MERELY DELIBERATE, which is what this comment used
 * to say. "It was approved to be dispatched by hand" is true only of a run that
 * went through approval at all; a run born from an order never can, so for
 * those the state is not a choice but a dead end (#2202). Either way the run is
 * READY and nothing further will happen, so a person is now told — see
 * `notifyDispatchByHand`. `failed` still needs a human too, and says why.
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
        /*
         * Names the policy default out loud. A partner has just been messaged
         * and given tasks; whether a person chose those templates or a standing
         * rule did is the first thing anyone auditing this will want, and it is
         * not recoverable from the run afterwards — `dispatched_template_ids`
         * looks identical either way.
         */
        logger.info(
          `[inventory-order-delivered] released run ${outcome.run_id} — goods from ${inventoryOrderId} delivered${
            outcome.via === "policy_default"
              ? " (templates from the dispatch-defaults policy, not an approval)"
              : ""
          }`
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
        /*
         * And TELL SOMEONE. The log line above has existed all along; it is
         * what let four runs sit ready-and-going-nowhere until a person
         * happened to ask. Awaited, not fired and forgotten, so the notifier's
         * own failure is logged rather than lost in an unhandled rejection.
         */
        await notifyDispatchByHand(
          container,
          {
            runId: outcome.run_id,
            releasedBy: inventoryOrderId,
            releasedByKind: "inventory order",
          },
          logger
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
