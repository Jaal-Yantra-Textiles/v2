import { sendProductionRunToProductionWorkflow } from "../../../workflows/production-runs/send-production-run-to-production"
import {
  selectDispatchInput,
  type DispatchSelection,
} from "../../../workflows/production-runs/lib/dispatch-selection"
import { releaseRunOnDependencyAttach } from "../../../workflows/production-runs/lib/release-dependent-runs"

/**
 * Auto-dispatch of the children an approval just created (#1268).
 *
 * Approval and dispatch are two workflows in one request and there is no
 * transaction across them. Approval commits first: parent approved, children
 * created. The dispatch that follows can fail — an ambiguous template name is a
 * hard failure since #1262, and task creation or partner linking can fail on
 * their own — and when it did, the throw escaped the route.
 *
 * That produced the worst available outcome. The admin saw a 500 saying the
 * approval failed; it had not. The run was approved, its children existed, and
 * NOTHING had been dispatched — no tasks, no partner notification. Worse, the
 * approval could not be retried: `assertCanApprove` only permits draft and
 * pending_review, and the parent was now approved. The run was stuck in exactly
 * the parked shape that had to be re-dispatched by hand on prod.
 *
 * So dispatch failures are collected, not thrown. The approval is real and the
 * response says so, alongside exactly which children went out and which did not
 * and why. Recovery is then the ordinary dispatch drawer, per child.
 */

export type AutoDispatchChild = {
  id: string
  dispatch_template_ids?: string[] | null
  dispatch_template_names?: string[] | null
  depends_on_run_ids?: string[] | null
  depends_on_inventory_order_ids?: string[] | null
}

export type AutoDispatchReport = {
  /** Runs that dispatched cleanly. */
  dispatched: string[]
  /** Runs with no template selection recorded — nothing to dispatch, not a failure. */
  skipped: string[]
  /** Runs whose dispatch threw. The approval still stands. */
  failed: Array<{ production_run_id: string; message: string }>
  /**
   * True when auto-dispatch was not attempted at all because the batch has
   * cross-run ordering — the admin sequences those by hand.
   */
  deferred_for_ordering: boolean
}

/**
 * Re-exported so existing importers of this module keep working; the
 * implementation moved to `workflows/production-runs/lib/dispatch-selection`
 * once the chain subscribers came to need the same choice (#1529).
 */
export { selectDispatchInput }
export type { DispatchSelection }

const clean = (values: unknown): string[] =>
  (Array.isArray(values) ? values : []).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  )

/**
 * Ordering means the admin drives dispatch sequencing themselves via
 * start-dispatch/resume-dispatch, and the release subscribers cascade the rest
 * as dependencies are met. Auto-dispatching here would start work out of order.
 *
 * Waiting on GOODS counts as ordering just as much as waiting on another run
 * (#1529). A stage-0 supplier is usually an inventory order rather than a run,
 * so a child with only that edge has an empty `depends_on_run_ids` — and
 * reading run edges alone would have auto-dispatched it at approval, sending a
 * partner work whose materials had not been ordered yet, let alone delivered.
 */
export const hasCrossRunOrdering = (children: AutoDispatchChild[]): boolean =>
  (children || []).some(
    (c) =>
      clean(c?.depends_on_run_ids).length > 0 ||
      clean(c?.depends_on_inventory_order_ids).length > 0
  )

export const autoDispatchApprovedChildren = async (
  scope: any,
  children: AutoDispatchChild[]
): Promise<AutoDispatchReport> => {
  const report: AutoDispatchReport = {
    dispatched: [],
    skipped: [],
    failed: [],
    deferred_for_ordering: false,
  }

  const list = children || []

  if (hasCrossRunOrdering(list)) {
    report.deferred_for_ordering = true

    /**
     * #2214 — deferring is right for SEQUENCING and wrong for an upstream that
     * is already met.
     *
     * A child born waiting on a sibling run is correctly deferred: that sibling
     * was created moments ago and cannot be `completed`, so the release
     * subscriber will take it when the sibling finishes. A child born waiting on
     * an inventory order that was DELIVERED LAST WEEK is a different animal —
     * the only event that could ever have released it is already in the past,
     * and returning here leaves it parked forever, indistinguishable from the
     * sibling case.
     *
     * 🔴 The sequencing guarantee is not weakened by asking. `releaseRunIfReady`
     * dispatches only when EVERY upstream is met, so a child waiting on a
     * sibling still waits; only the already-satisfied child goes. That is the
     * same test the subscriber would have applied had an event existed.
     */
    for (const child of list) {
      const inventoryIds = clean(child?.depends_on_inventory_order_ids)
      const runIds = clean(child?.depends_on_run_ids)
      if (!inventoryIds.length && !runIds.length) {
        /* No edge of its own — it is deferred with the batch, as before. */
        continue
      }

      const outcome = await releaseRunOnDependencyAttach(scope, child.id, {
        by: (inventoryIds.length ? inventoryIds : runIds).join(", "),
        kind: inventoryIds.length ? "inventory order" : "production run",
      })

      if (outcome.result === "dispatched") {
        report.dispatched.push(child.id)
      } else if (outcome.result === "failed") {
        report.failed.push({
          production_run_id: child.id,
          message: outcome.message,
        })
      }
      /*
       * `waiting` is the expected answer for a properly sequenced child and is
       * deliberately not reported as anything: it is the batch working. Same
       * for `no_templates` — `notifyDispatchByHand` has already told a person.
       */
    }

    return report
  }

  for (const child of list) {
    const selection = selectDispatchInput(child)

    if (!selection) {
      report.skipped.push(child.id)
      continue
    }

    try {
      await sendProductionRunToProductionWorkflow(scope).run({
        input: { production_run_id: child.id, ...selection },
      })
      report.dispatched.push(child.id)
    } catch (e: any) {
      // The approval stands. Carry the reason back so the admin knows what to
      // fix — an ambiguous name error names the colliding ids to retry with.
      report.failed.push({
        production_run_id: child.id,
        message: String(e?.message || e || "Dispatch failed"),
      })
    }
  }

  return report
}
