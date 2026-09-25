/**
 * Whether a partner may bill for a task — decided ONCE.
 *
 * The rule existed twice. The write path enforced it
 * (`create-payment-submission.ts`: status must be `completed`, a cost must be
 * readable, the task must belong to the partner, and it must not sit in an
 * active submission). The partner UI enforced its own copy — a
 * `const ELIGIBLE_TASK_STATUSES = ["completed"]` in the create screen — and
 * filtered the list against it client-side.
 *
 * ⚠️ THE TWO AGREED. That is worth stating plainly, because the reason to
 * collapse them is not a live defect: it is that nothing made them agree. A
 * partner on a stale bundle and a server on a new rule disagree silently, and
 * the disagreement surfaces as a refusal at the end of a form the partner has
 * already filled in — which reads as the platform being broken, not as the task
 * being ineligible.
 *
 * Runs already work the other way round: `payable-runs` serves the list and the
 * client renders what it is given. This brings tasks alongside them.
 *
 * 🔴 The write path keeps its own checks. This is not a replacement for them —
 * a read route can be stale by the time a form is submitted, and ownership and
 * the active-submission check both need a database. This decides what a partner
 * is OFFERED; the workflow still decides what is ACCEPTED.
 */

/** The only status a task may be billed from. */
export const PAYABLE_TASK_STATUSES = ["completed"] as const

export type PayableTaskInput = {
  id?: string | null
  title?: string | null
  status?: string | null
  parent_task_id?: string | null
  estimated_cost?: number | string | null
  actual_cost?: number | string | null
  cost_currency?: string | null
  cost_type?: string | null
}

export type TaskPayableVerdict = {
  payable: boolean
  /** Why not, in the partner's terms. Null when it is payable. */
  reason: string | null
  /** What it would be billed at — `actual_cost`, else `estimated_cost`. */
  amount: number | null
}

/**
 * What the partner typed on the submission form for this task, when they did.
 *
 * 🔴 A POSITIVE OVERRIDE IS A COST. The create form lets a partner enter the
 * price of a finished task that has none stored, and the write path has always
 * billed that amount (`sanitizeCostOverrides` in create-payment-submission.ts).
 * When this rule first moved here it read only the stored costs, so a task
 * priced by the partner was refused as "No cost agreed" before the override
 * was ever looked at — the form was offered, filled in, and then rejected.
 *
 * Only the write path passes one. The read route has no form to read from, so
 * a no-cost task is still OFFERED as not payable, with the reason — which is
 * what tells the partner to type a price.
 */
export type TaskPayableOptions = {
  costOverride?: number | null
}

const readAmount = (
  task: PayableTaskInput,
  opts: TaskPayableOptions = {}
): number | null => {
  const override = Number(opts.costOverride)
  // Positive only: a zero or junk override must not turn an absent cost into
  // a free job, nor mask a stored one.
  if (opts.costOverride != null && Number.isFinite(override) && override > 0) {
    return override
  }
  for (const candidate of [task?.actual_cost, task?.estimated_cost]) {
    if (candidate === null || candidate === undefined) continue
    const n = Number(candidate)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * PURE: may this task be offered to its partner as claimable?
 *
 * Ordered so the reason a partner sees is the most useful one. "Not finished
 * yet" is actionable by them; "no cost agreed" is not, and needs an admin — so
 * doneness is reported first when both are true.
 *
 * ⚠️ A SUBTASK IS NEVER CLAIMED ON ITS OWN. The cost lives on the parent and
 * the work on its children; offering both would invite billing the same job
 * twice, once as the parent and once piecemeal.
 */
export const taskPayableVerdict = (
  task: PayableTaskInput,
  opts: TaskPayableOptions = {}
): TaskPayableVerdict => {
  const amount = readAmount(task, opts)

  if (task?.parent_task_id) {
    return {
      payable: false,
      reason: "Part of another task — claim the parent task instead",
      amount,
    }
  }

  const status = String(task?.status ?? "")
  if (!PAYABLE_TASK_STATUSES.includes(status as any)) {
    return {
      payable: false,
      reason: `Not finished yet (${status || "no status"})`,
      amount,
    }
  }

  if (amount === null) {
    return {
      payable: false,
      reason: "No cost agreed on this task",
      amount: null,
    }
  }

  /*
   * A zero is not a missing number — `Number(null)` is 0 and an absent cost
   * would otherwise read as a free job someone could submit. `readAmount`
   * already separates them; this only refuses a genuine zero, which is nothing
   * to pay and so nothing to claim.
   */
  if (amount <= 0) {
    return {
      payable: false,
      reason: "Nothing to claim — the agreed cost is zero",
      amount,
    }
  }

  return { payable: true, reason: null, amount }
}

/** Convenience for the write path, which only needs the yes/no. */
export const isTaskPayable = (
  task: PayableTaskInput,
  opts: TaskPayableOptions = {}
): boolean => taskPayableVerdict(task, opts).payable
