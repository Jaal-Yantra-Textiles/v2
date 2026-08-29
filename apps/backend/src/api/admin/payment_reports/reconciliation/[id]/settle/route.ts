import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { settlePaymentReconciliationWorkflow } from "../../../../../../workflows/payment_reports/settle-payment-reconciliation"

/**
 * POST /admin/payment_reports/reconciliation/:id/settle
 *
 * Settling now also marks the payout's submission `Paid` and stamps `paid_at`,
 * and it is what fires `payment_submission.paid` to the partner. Approval sets
 * `Approved` and stops there (#1639) — it used to claim `Paid` up to 34 days
 * before the money moved.
 *
 * The validation and the reconciliation write moved into the workflow so both
 * records land in one compensatable transaction rather than two loose updates.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = (req.validatedBody || {}) as any
  const settledBy = (req as any).auth_context?.actor_id || "admin"

  const { result } = await settlePaymentReconciliationWorkflow(req.scope).run({
    input: {
      reconciliation_id: id,
      settled_by: settledBy,
      notes: body.notes,
    },
  })

  return res.status(200).json({ reconciliation: result.reconciliation })
}
