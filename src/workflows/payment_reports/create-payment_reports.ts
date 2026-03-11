import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments"
import { PAYMENT_REPORTS_MODULE } from "../../modules/payment_reports"
import Payment_reportsService from "../../modules/payment_reports/service"
import InternalPaymentService from "../../modules/internal_payments/service"
import PartnerPaymentsLink from "../../links/partner-payments-link"
import PersonPaymentsLink from "../../links/person-payments-link"

export type CreatePaymentReportInput = {
  name?: string
  period_start: string
  period_end: string
  entity_type?: "all" | "partner" | "person"
  entity_id?: string
  status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled"
  payment_type?: "Bank" | "Cash" | "Digital_Wallet"
  metadata?: Record<string, any>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aggregatePayments(payments: any[]) {
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

  const by_month = Object.entries(by_month_map)
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return { total_amount, payment_count: payments.length, by_status, by_type, by_month }
}

function applyLocalFilters(
  payments: any[],
  opts: { period_start?: string; period_end?: string; status?: string; payment_type?: string }
) {
  const start = opts.period_start ? new Date(opts.period_start) : null
  const end = opts.period_end ? new Date(opts.period_end) : null
  return payments.filter((p) => {
    const pd = p.payment_date ? new Date(p.payment_date) : null
    if (start && pd && pd < start) return false
    if (end && pd && pd > end) return false
    if (opts.status && p.status !== opts.status) return false
    if (opts.payment_type && p.payment_type !== opts.payment_type) return false
    return true
  })
}

// ─── Step 1: Fetch payments (scoped by entity or global) ─────────────────────

const fetchPaymentsStep = createStep(
  "fetch-payments-for-report-step",
  async (input: CreatePaymentReportInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const paymentService: InternalPaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE)

    const { period_start, period_end, entity_type = "all", entity_id, status, payment_type } = input

    let rawPayments: any[] = []

    if (entity_type === "partner" && entity_id) {
      const { data } = await query.graph({
        entity: PartnerPaymentsLink.entryPoint,
        fields: ["internal_payments.*"],
        filters: { partner_id: entity_id },
      })
      rawPayments = (data ?? []).map((r: any) => r.internal_payments).filter(Boolean)
    } else if (entity_type === "person" && entity_id) {
      const { data } = await query.graph({
        entity: PersonPaymentsLink.entryPoint,
        fields: ["internal_payments.*"],
        filters: { person_id: entity_id },
      })
      rawPayments = (data ?? []).map((r: any) => r.internal_payments).filter(Boolean)
    } else {
      // All entities — fetch via service (no date filter support in MedusaService v2 without raw query)
      const [payments] = await paymentService.listAndCountPayments({}, { take: 10000 })
      rawPayments = payments
    }

    // Apply date + field filters in JS (works for all entity types)
    const payments = applyLocalFilters(rawPayments, { period_start, period_end, status, payment_type })

    return new StepResponse(payments)
  }
)

// ─── Step 2: Persist snapshot ─────────────────────────────────────────────────

const saveReportSnapshotStep = createStep(
  "save-payment-report-snapshot-step",
  async (
    input: { payments: any[]; reportInput: CreatePaymentReportInput },
    { container }
  ) => {
    const service: Payment_reportsService = container.resolve(PAYMENT_REPORTS_MODULE)
    const { payments, reportInput } = input

    const { total_amount, payment_count, by_status, by_type, by_month } = aggregatePayments(payments)

    const report = await service.createPayment_reports({
      name: reportInput.name,
      period_start: new Date(reportInput.period_start),
      period_end: new Date(reportInput.period_end),
      entity_type: reportInput.entity_type ?? "all",
      entity_id: reportInput.entity_id ?? null,
      total_amount,
      payment_count,
      by_status,
      by_type,
      by_month: by_month as unknown as Record<string, unknown>,
      generated_at: new Date(),
      filters: {
        status: reportInput.status,
        payment_type: reportInput.payment_type,
      },
      metadata: reportInput.metadata ?? null,
    })

    return new StepResponse(report, { id: (report as any).id })
  },
  async (compensationInput, { container }) => {
    if (!compensationInput) return
    const service: Payment_reportsService = container.resolve(PAYMENT_REPORTS_MODULE)
    await service.deletePayment_reports({ id: compensationInput.id })
  }
)

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const createPayment_reportWorkflow = createWorkflow(
  "create-payment-report",
  (input: CreatePaymentReportInput) => {
    const payments = fetchPaymentsStep(input)
    const report = saveReportSnapshotStep({
      payments: payments as unknown as any[],
      reportInput: input,
    })
    return new WorkflowResponse(report)
  }
)
