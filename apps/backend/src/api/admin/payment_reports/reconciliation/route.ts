import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PAYMENT_REPORTS_MODULE } from "../../../../modules/payment_reports"
import Payment_reportsService from "../../../../modules/payment_reports/service"

// GET /admin/payment_reports/reconciliation — list reconciliation records
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const {
    offset = 0,
    limit = 20,
    status,
    partner_id,
    reference_type,
    period_start,
    period_end,
  } = (req.validatedQuery || req.query) as any

  const service: Payment_reportsService = req.scope.resolve(
    PAYMENT_REPORTS_MODULE
  )

  const filters: any = {}
  if (status) filters.status = status
  if (partner_id) filters.partner_id = partner_id
  if (reference_type) filters.reference_type = reference_type

  const [records, count] = await service.listAndCountPaymentReconciliations(
    filters,
    {
      skip: Number(offset),
      take: Number(limit),
      order: { created_at: "DESC" },
    }
  )

  // Apply date filters in JS if provided (created_at based)
  let filtered = records
  if (period_start || period_end) {
    filtered = records.filter((r: any) => {
      const created = new Date(r.created_at).getTime()
      if (period_start && created < new Date(period_start).getTime())
        return false
      if (period_end && created > new Date(period_end).getTime()) return false
      return true
    })
  }

  return res.status(200).json({
    reconciliations: filtered,
    count: period_start || period_end ? filtered.length : count,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// POST /admin/payment_reports/reconciliation — manually create a reconciliation
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = req.validatedBody as any

  const service: Payment_reportsService = req.scope.resolve(
    PAYMENT_REPORTS_MODULE
  )

  const discrepancy =
    body.actual_amount != null
      ? body.actual_amount - body.expected_amount
      : null
  const status =
    discrepancy !== null
      ? Math.abs(discrepancy) < 0.01
        ? "Matched"
        : "Discrepant"
      : "Pending"

  const reconciliation = await service.createPaymentReconciliations({
    reference_type: body.reference_type,
    reference_id: body.reference_id || null,
    partner_id: body.partner_id || null,
    expected_amount: body.expected_amount,
    actual_amount: body.actual_amount ?? null,
    discrepancy,
    status,
    payment_id: body.payment_id || null,
    notes: body.notes || null,
    metadata: body.metadata || null,
  })

  return res.status(201).json({ reconciliation })
}
