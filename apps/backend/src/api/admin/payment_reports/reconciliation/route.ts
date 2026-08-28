import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { PAYMENT_REPORTS_MODULE } from "../../../../modules/payment_reports"
import Payment_reportsService from "../../../../modules/payment_reports/service"
import { resolvePaymentEntities } from "../../payment-submissions/lib/resolve-payment-entities"

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

  /**
   * Resolved names alongside the ids (#1622).
   *
   * The table rendered `partner_id` and `source_id` as raw ULIDs, one per row —
   * the reconciliation screen is where a discrepancy is chased, and a column of
   * indistinguishable ids is the least useful place to do it. `source_id` is
   * resolved by `source_type`, so an `inventory_order` row names the order and a
   * `run` row names the run; a `mixed` payout keeps a null source by design and
   * simply has no name to show.
   *
   * Best-effort throughout — see `resolvePaymentEntities`. A record of money
   * must render even when what it paid for is gone.
   */
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const resolved = await resolvePaymentEntities(query, {
    partnerIds: filtered.map((r: any) => r.partner_id),
    designIds: filtered
      .filter((r: any) => r.source_type === "design")
      .map((r: any) => r.source_id),
    runIds: filtered
      .filter((r: any) => r.source_type === "run")
      .map((r: any) => r.source_id),
    inventoryOrderIds: filtered
      .filter((r: any) => r.source_type === "inventory_order")
      .map((r: any) => r.source_id),
  })

  const sourceRef = (record: any) => {
    if (!record.source_id) return null
    switch (record.source_type) {
      case "design":
        return resolved.designs.get(record.source_id) ?? null
      case "run":
        return resolved.runs.get(record.source_id) ?? null
      case "inventory_order":
        return resolved.inventoryOrders.get(record.source_id) ?? null
      default:
        return null
    }
  }

  for (const record of filtered as any[]) {
    record.partner = record.partner_id
      ? resolved.partners.get(record.partner_id) ?? null
      : null
    record.source = sourceRef(record)
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
