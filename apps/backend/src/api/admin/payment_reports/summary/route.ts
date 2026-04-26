/**
 * GET /admin/payment_reports/summary
 *
 * Live aggregate totals across all payments (no snapshot saved).
 * Supports filtering by period_start, period_end, status, payment_type, limit, offset.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { INTERNAL_PAYMENTS_MODULE } from "../../../../modules/internal_payments"
import { PAYMENT_REPORTS_MODULE } from "../../../../modules/payment_reports"
import InternalPaymentService from "../../../../modules/internal_payments/service"
import Payment_reportsService from "../../../../modules/payment_reports/service"
import { ReportingQuery } from "../validators"

function aggregate(payments: any[]) {
  let total_amount = 0
  const by_status: Record<string, number> = {}
  const by_type: Record<string, number> = {}
  const by_month_map: Record<string, { amount: number; count: number }> = {}

  for (const p of payments) {
    const amount = Number(p.amount ?? 0)
    total_amount += amount

    const status = p.status ?? "Unknown"
    by_status[status] = (by_status[status] ?? 0) + 1

    const type = p.payment_type ?? "Unknown"
    by_type[type] = (by_type[type] ?? 0) + amount

    if (p.payment_date) {
      const month = new Date(p.payment_date).toISOString().slice(0, 7)
      if (!by_month_map[month]) by_month_map[month] = { amount: 0, count: 0 }
      by_month_map[month].amount += amount
      by_month_map[month].count += 1
    }
  }

  return {
    total_amount,
    payment_count: payments.length,
    by_status,
    by_type,
    by_month: Object.entries(by_month_map)
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  }
}

export const GET = async (req: MedusaRequest<ReportingQuery>, res: MedusaResponse) => {
  const {
    period_start,
    period_end,
    status,
    payment_type,
    limit = 100,
    offset = 0,
  } = (req.validatedQuery ?? {}) as Partial<ReportingQuery>

  const service: InternalPaymentService = req.scope.resolve(INTERNAL_PAYMENTS_MODULE)

  // Fetch all payments (service doesn't support date range natively — filter in JS)
  const [allPayments] = await service.listAndCountPayments({}, { take: 10000 })

  const start = period_start ? new Date(period_start) : null
  const end = period_end ? new Date(period_end) : null

  const filtered = allPayments.filter((p: any) => {
    const pd = p.payment_date ? new Date(p.payment_date) : null
    if (start && pd && pd < start) return false
    if (end && pd && pd > end) return false
    if (status && p.status !== status) return false
    if (payment_type && p.payment_type !== payment_type) return false
    return true
  })

  const totals = aggregate(filtered)

  // Paginated payment list for this response
  const payments = filtered.slice(offset, offset + limit)

  // Reconciliation summary
  let reconciliation_summary: any = null
  const includeReconciliation = (req.query as any).include_reconciliation
  if (includeReconciliation === "true" || includeReconciliation === "1") {
    const reportsService: Payment_reportsService = req.scope.resolve(PAYMENT_REPORTS_MODULE)
    const [allRecon] = await reportsService.listAndCountPaymentReconciliations(
      {},
      { take: 10000 }
    )

    let total_expected = 0
    let total_actual = 0
    let total_discrepancy = 0
    const by_status: Record<string, number> = {}

    for (const r of allRecon as any[]) {
      total_expected += Number(r.expected_amount ?? 0)
      total_actual += Number(r.actual_amount ?? 0)
      total_discrepancy += Number(r.discrepancy ?? 0)
      const s = r.status ?? "Unknown"
      by_status[s] = (by_status[s] ?? 0) + 1
    }

    reconciliation_summary = {
      total_expected,
      total_actual,
      total_discrepancy,
      record_count: allRecon.length,
      by_status,
    }
  }

  res.status(200).json({
    ...totals,
    payments,
    count: filtered.length,
    offset,
    limit,
    period_start: period_start ?? null,
    period_end: period_end ?? null,
    reconciliation_summary,
  })
}
