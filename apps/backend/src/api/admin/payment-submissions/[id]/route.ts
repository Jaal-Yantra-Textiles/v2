import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../modules/payment_submissions"
import PaymentSubmissionsService from "../../../../modules/payment_submissions/service"
import { deletePaymentSubmissionWorkflow } from "../../../../workflows/payment_submissions/delete-payment-submission"
import {
  collectLineRefs,
  resolvePaymentEntities,
} from "../lib/resolve-payment-entities"

/**
 * GET /admin/payment-submissions/:id — submission detail.
 *
 * 🔴 Resolved names come with it (#1622). The page rendered `partner_id` as a
 * raw ULID — the one field saying WHO is being paid — and a run-sourced line
 * as "7 run(s)" with no way to reach any of them. The ids were all correct and
 * none of them was readable.
 *
 * ⚠️ This route uses `service.listPaymentSubmissions`, NOT `query.graph`, so
 * `?fields=payments.id` is silently ignored here and links do not expand. That
 * is why the names are resolved explicitly below rather than requested as
 * relations.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const submissions = await service.listPaymentSubmissions(
    { id: [id] },
    { relations: ["items"] }
  )

  const submission = submissions[0]
  if (!submission) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment submission not found: ${id}`
    )
  }

  const items: any[] = (submission as any).items || []

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const resolved = await resolvePaymentEntities(query, {
    partnerIds: [(submission as any).partner_id],
    ...collectLineRefs(items),
  })

  /**
   * Attached alongside the ids, never in place of them. A screen that lost the
   * id would have nothing to fall back to when a name cannot be resolved, and
   * an unresolvable design is exactly the case that must still render.
   */
  ;(submission as any).partner =
    resolved.partners.get((submission as any).partner_id) ?? null

  for (const item of items) {
    item.design = item.design_id
      ? resolved.designs.get(item.design_id) ?? null
      : null
    item.order = item.order_id ? resolved.orders.get(item.order_id) ?? null : null
    item.inventory_order = item.inventory_order_id
      ? resolved.inventoryOrders.get(item.inventory_order_id) ?? null
      : null
    /**
     * Every run this line pays for, in order, with the ones that could not be
     * resolved kept as a bare id — a deleted run must not silently shrink the
     * list a payout says it covers.
     */
    item.runs = ((item.production_run_ids || []) as string[]).map(
      (runId) =>
        resolved.runs.get(runId) ?? { id: runId, name: runId, detail: null }
    )
  }

  return res.status(200).json({ payment_submission: submission })
}

// DELETE /admin/payment-submissions/:id — remove a Draft (#1604)
//
// Draft only. See `deletePaymentSubmissionWorkflow` for why anything else is
// refused rather than soft-deleted: a Pending claim is reviewed, and an
// Approved or Paid one is the record of money that already moved.
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const { result } = await deletePaymentSubmissionWorkflow(req.scope).run({
    input: { submission_id: id },
  })

  return res.status(200).json({
    id: result.id,
    object: "payment_submission",
    deleted: result.deleted,
  })
}
