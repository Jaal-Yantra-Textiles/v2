import { sendProductionRunToProductionWorkflow } from "../../../workflows/production-runs/send-production-run-to-production"

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
}

export type DispatchSelection =
  | { template_ids: string[] }
  | { template_names: string[] }
  | null

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

const clean = (values: unknown): string[] =>
  (Array.isArray(values) ? values : []).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  )

/**
 * What to dispatch a child with, preferring identity over label.
 *
 * Ids win outright: a name may match two templates that are different process
 * steps sharing one label (#1261), and dispatch refuses such a name rather than
 * guessing. Returns null when the approval named nothing — that run is meant to
 * be dispatched later, by hand.
 */
export const selectDispatchInput = (
  child: AutoDispatchChild
): DispatchSelection => {
  const ids = clean(child?.dispatch_template_ids)
  if (ids.length) {
    return { template_ids: ids }
  }

  const names = clean(child?.dispatch_template_names)
  if (names.length) {
    return { template_names: names }
  }

  return null
}

/**
 * Cross-run ordering means the admin drives dispatch sequencing themselves via
 * start-dispatch/resume-dispatch, and the task subscriber cascades the rest as
 * dependencies complete. Auto-dispatching here would start work out of order.
 */
export const hasCrossRunOrdering = (children: AutoDispatchChild[]): boolean =>
  (children || []).some((c) => clean(c?.depends_on_run_ids).length > 0)

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
