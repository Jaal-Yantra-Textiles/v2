import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import partnerTaskLink from "../../../../links/partner-task"
import submissionTasksLink from "../../../../links/submission-tasks-link"
import { taskPayableVerdict } from "../../../../workflows/payment_submissions/lib/task-payable"
import { getPartnerFromAuthContext } from "../../helpers"

/**
 * GET /partners/payment-submissions/payable-tasks
 *
 * The standalone tasks this authenticated partner can bill for, one row per
 * task. The sibling of `payable-runs` and `payable-inventory-orders`, which
 * were the only two sources the claim screen could offer.
 *
 * ⚠️ Tasks were already claimable — `POST /partners/payment-submissions`
 * accepts `task_ids` and the workflow has enforced eligibility all along. What
 * was missing was the LIST: the partner UI derived it client-side from its own
 * copy of the rule. The two agreed; nothing made them agree. This serves the
 * decision so a stale bundle cannot hold a different opinion than the server
 * that will judge the submission.
 *
 * 🔴 Ineligible tasks are RETURNED, not filtered out, each with a reason.
 * A partner who has finished a photoshoot and cannot find it on this screen has
 * no way to tell "I did not finish it properly" from "the platform lost it" —
 * and the second reading is the one that costs a support conversation. The
 * client may still choose to show only the payable ones; it can no longer be
 * the thing that DECIDES which those are.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<never>,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no actor ID"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no partner found"
    )
  }

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  /*
   * The partner's tasks, through the link — the same relation the portal's own
   * task list traverses, so a task that appears there can appear here.
   */
  const { data: links = [] } = await query.graph({
    entity: partnerTaskLink.entryPoint,
    fields: ["task_id"],
    filters: { partner_id: partner.id },
  })

  const taskIds = [
    ...new Set(
      (links as any[]).map((l) => l?.task_id).filter(Boolean).map(String)
    ),
  ]

  if (!taskIds.length) {
    return res.json({ tasks: [], count: 0 })
  }

  const { data: tasks = [] } = await query.graph({
    entity: "task",
    fields: [
      "id",
      "title",
      "description",
      "status",
      "parent_task_id",
      "estimated_cost",
      "actual_cost",
      "cost_currency",
      "cost_type",
      "completed_at",
      "created_at",
    ],
    filters: { id: taskIds },
  })

  /*
   * Already claimed, in the same sense the write path means it: a task sitting
   * in a Pending or Under_Review submission is spoken for. A rejected or
   * cancelled submission releases it — which is why the status set is named
   * here rather than "has any link".
   */
  const { data: submissionLinks = [] } = await query.graph({
    entity: submissionTasksLink.entryPoint,
    fields: ["task_id", "payment_submission.status"],
    filters: { task_id: taskIds },
  })

  const ACTIVE = new Set(["Pending", "Under_Review"])
  const claimed = new Set(
    (submissionLinks as any[])
      .filter((l) => ACTIVE.has(String(l?.payment_submission?.status)))
      .map((l) => String(l?.task_id))
  )

  const rows = (tasks as any[]).map((task) => {
    const verdict = taskPayableVerdict(task)
    const isClaimed = claimed.has(String(task.id))

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      parent_task_id: task.parent_task_id,
      cost_currency: task.cost_currency,
      cost_type: task.cost_type,
      estimated_cost: task.estimated_cost,
      actual_cost: task.actual_cost,
      completed_at: task.completed_at,
      created_at: task.created_at,
      amount: verdict.amount,
      /* Claimed beats every other reason: it is the one a partner acts on. */
      payable: verdict.payable && !isClaimed,
      reason: isClaimed
        ? "Already in a payment submission awaiting review"
        : verdict.reason,
      already_claimed: isClaimed,
    }
  })

  rows.sort((a, b) => {
    if (a.payable !== b.payable) return a.payable ? -1 : 1
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  })

  return res.json({
    tasks: rows,
    count: rows.length,
    payable_count: rows.filter((r) => r.payable).length,
  })
}
