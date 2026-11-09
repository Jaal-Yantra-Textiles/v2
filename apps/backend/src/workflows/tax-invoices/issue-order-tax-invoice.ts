import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { TAX_INVOICE_MODULE } from "../../modules/tax_invoice"
import type TaxInvoiceService from "../../modules/tax_invoice/service"
import { gatherOrderTaxInvoice } from "../../lib/invoices/gather-order-tax-invoice"
import {
  buildOrderTaxInvoiceModel,
  financialYearOf,
  formatInvoiceNumber,
  type OrderTaxInvoiceModel,
} from "../../lib/invoices/order-tax-invoice-model"
import { decideIssue } from "./lib/decide-issue"

export type IssueOrderTaxInvoiceInput = {
  order_id: string
  buyer_gstin?: string | null
  /** Cancel the current invoice and issue a new one for a changed order. */
  reissue?: boolean
}

export type IssueOrderTaxInvoiceResult = {
  invoice: any
  /** false when an unchanged order's existing invoice was returned. */
  created: boolean
  cancelled_invoice_id: string | null
}

/** How many times to retry when a concurrent issue took the same number. */
const NUMBER_RETRIES = 3

const isUniqueViolation = (e: any) =>
  /unique|duplicate key/i.test(String(e?.message ?? "")) || e?.code === "23505"

const issueOrderTaxInvoiceStep = createStep(
  "issue-order-tax-invoice-step",
  async (input: IssueOrderTaxInvoiceInput, { container }) => {
    const service: TaxInvoiceService = container.resolve(TAX_INVOICE_MODULE)
    const now = new Date()
    const invoiceDate = now.toISOString()

    // Built without a number first: it decides reuse vs re-bill, and it throws
    // (lines don't add up, partner store, no GSTIN) before a number is spent.
    const gathered = await gatherOrderTaxInvoice(container, input.order_id, {
      invoice_number: null,
      invoice_date: invoiceDate,
      buyer_gstin: input.buyer_gstin,
    })
    const draft = buildOrderTaxInvoiceModel(gathered)

    const [current] = await service.listTaxInvoices(
      { order_id: input.order_id, status: "issued" },
      { order: { issued_at: "DESC" }, take: 1 }
    )
    const decision = decideIssue(
      current
        ? {
            id: current.id,
            invoice_number: current.invoice_number,
            document: current.document as unknown as OrderTaxInvoiceModel,
          }
        : null,
      draft,
      { reissue: input.reissue }
    )

    if (decision.action === "refuse") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, decision.reason)
    }
    if (decision.action === "reuse") {
      return new StepResponse<IssueOrderTaxInvoiceResult, any>(
        { invoice: current, created: false, cancelled_invoice_id: null },
        null
      )
    }

    const financialYear = financialYearOf(now)
    let created: any = null
    for (let attempt = 0; attempt < NUMBER_RETRIES && !created; attempt++) {
      // Cancelled invoices keep their numbers: the next number follows the
      // highest ever used this year, cancelled or not.
      const [last] = await service.listTaxInvoices(
        { financial_year: financialYear },
        { order: { sequence: "DESC" }, take: 1 }
      )
      const sequence = Number(last?.sequence ?? 0) + 1
      const invoiceNumber = formatInvoiceNumber(financialYear, sequence)
      const document = buildOrderTaxInvoiceModel({
        ...gathered,
        invoice_number: invoiceNumber,
      })
      try {
        created = await service.createTaxInvoices({
          order_id: input.order_id,
          invoice_number: invoiceNumber,
          financial_year: financialYear,
          sequence,
          status: "issued",
          issued_at: now,
          currency_code: document.currency_code,
          grand_total: document.totals.grand_total,
          document: document as unknown as Record<string, unknown>,
        })
      } catch (e) {
        if (!isUniqueViolation(e) || attempt === NUMBER_RETRIES - 1) throw e
      }
    }

    if (decision.cancel_invoice_id) {
      await service.updateTaxInvoices({
        id: decision.cancel_invoice_id,
        status: "cancelled",
        cancelled_at: now,
        cancel_reason: `Superseded by ${created.invoice_number}`,
      })
    }

    return new StepResponse<IssueOrderTaxInvoiceResult, any>(
      { invoice: created, created: true, cancelled_invoice_id: decision.cancel_invoice_id },
      { created_id: created.id, cancelled_id: decision.cancel_invoice_id }
    )
  },
  async (undo: { created_id: string; cancelled_id: string | null } | null, { container }) => {
    if (!undo) return
    const service: TaxInvoiceService = container.resolve(TAX_INVOICE_MODULE)
    // The invoice was never handed to anyone, so its row goes; the number may
    // be reused.
    await service.deleteTaxInvoices(undo.created_id)
    if (undo.cancelled_id) {
      await service.updateTaxInvoices({
        id: undo.cancelled_id,
        status: "issued",
        cancelled_at: null,
        cancel_reason: null,
      })
    }
  }
)

/**
 * Issue (or return) the GST tax invoice for an order (#2532). See
 * `lib/decide-issue.ts` for when a new number is spent.
 */
export const issueOrderTaxInvoiceWorkflow = createWorkflow(
  "issue-order-tax-invoice",
  (input: IssueOrderTaxInvoiceInput) => {
    const result = issueOrderTaxInvoiceStep(input)
    return new WorkflowResponse(result)
  }
)

export default issueOrderTaxInvoiceWorkflow
