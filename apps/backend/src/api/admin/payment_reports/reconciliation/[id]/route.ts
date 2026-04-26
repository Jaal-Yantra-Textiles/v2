import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_REPORTS_MODULE } from "../../../../../modules/payment_reports"
import Payment_reportsService from "../../../../../modules/payment_reports/service"

// GET /admin/payment_reports/reconciliation/:id
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: Payment_reportsService = req.scope.resolve(
    PAYMENT_REPORTS_MODULE
  )

  const records = await service.listPaymentReconciliations({ id: [id] })
  const record = records[0]

  if (!record) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Reconciliation record not found: ${id}`
    )
  }

  return res.status(200).json({ reconciliation: record })
}

// PATCH /admin/payment_reports/reconciliation/:id
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const body = req.validatedBody as any

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

  const updateData: Record<string, any> = { id }

  if (body.actual_amount !== undefined) {
    updateData.actual_amount = body.actual_amount
    // Recompute discrepancy
    const expected = Number(existing[0].expected_amount)
    updateData.discrepancy = body.actual_amount - expected
    // Auto-set status if not explicitly provided
    if (!body.status) {
      updateData.status =
        Math.abs(updateData.discrepancy) < 0.01 ? "Matched" : "Discrepant"
    }
  }

  if (body.status) updateData.status = body.status
  if (body.notes !== undefined) updateData.notes = body.notes
  if (body.metadata !== undefined) updateData.metadata = body.metadata

  const updated = await service.updatePaymentReconciliations(updateData)

  return res.status(200).json({ reconciliation: updated })
}
