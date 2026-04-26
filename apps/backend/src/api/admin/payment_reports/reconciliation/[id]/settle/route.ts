import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_REPORTS_MODULE } from "../../../../../../modules/payment_reports"
import Payment_reportsService from "../../../../../../modules/payment_reports/service"

// POST /admin/payment_reports/reconciliation/:id/settle
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = (req.validatedBody || {}) as any
  const settledBy = (req as any).auth_context?.actor_id || "admin"

  const service: Payment_reportsService = req.scope.resolve(
    PAYMENT_REPORTS_MODULE
  )

  const existing = await service.listPaymentReconciliations({ id: [id] })
  if (!existing[0]) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Reconciliation record not found: ${id}`
    )
  }

  if (existing[0].status === "Settled") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This reconciliation is already settled"
    )
  }

  const updateData: Record<string, any> = {
    id,
    status: "Settled",
    settled_at: new Date(),
    settled_by: settledBy,
  }

  if (body.notes) {
    updateData.notes = body.notes
  }

  const updated = await service.updatePaymentReconciliations(updateData)

  return res.status(200).json({ reconciliation: updated })
}
