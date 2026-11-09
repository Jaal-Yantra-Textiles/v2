import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { TAX_INVOICE_MODULE } from "../../../../../modules/tax_invoice"
import type TaxInvoiceService from "../../../../../modules/tax_invoice/service"
import { gatherOrderTaxInvoice } from "../../../../../lib/invoices/gather-order-tax-invoice"
import { buildOrderTaxInvoiceModel } from "../../../../../lib/invoices/order-tax-invoice-model"
import { issueOrderTaxInvoiceWorkflow } from "../../../../../workflows/tax-invoices/issue-order-tax-invoice"
import type { IssueOrderTaxInvoiceBody } from "./validators"

/**
 * GET /admin/orders/:id/tax-invoices
 *
 * Every GST tax invoice issued for the order, newest first — cancelled ones
 * included, because a cancelled number still exists (#2532).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: TaxInvoiceService = req.scope.resolve(TAX_INVOICE_MODULE)
  const invoices = await service.listTaxInvoices(
    { order_id: req.params.id },
    {
      select: [
        "id",
        "order_id",
        "invoice_number",
        "financial_year",
        "status",
        "issued_at",
        "currency_code",
        "grand_total",
        "cancelled_at",
        "cancel_reason",
      ],
      order: { issued_at: "DESC" },
    }
  )
  res.json({ tax_invoices: invoices })
}

/**
 * POST /admin/orders/:id/tax-invoices
 *
 * Issue the order's GST tax invoice, or return the existing one when the order
 * has not changed. `{ preview: true }` returns the invoice as it would print and
 * writes nothing. A changed order needs `reissue: true`, which cancels the
 * current invoice. Sends nothing to the customer.
 */
export const POST = async (
  req: MedusaRequest<IssueOrderTaxInvoiceBody>,
  res: MedusaResponse
) => {
  const body = (req.validatedBody ?? {}) as IssueOrderTaxInvoiceBody

  if (body.preview) {
    const gathered = await gatherOrderTaxInvoice(req.scope, req.params.id, {
      invoice_number: null,
      invoice_date: new Date().toISOString(),
      buyer_gstin: body.buyer_gstin,
    })
    return res.json({ preview: buildOrderTaxInvoiceModel(gathered) })
  }

  const { result } = await issueOrderTaxInvoiceWorkflow(req.scope).run({
    input: {
      order_id: req.params.id,
      buyer_gstin: body.buyer_gstin,
      reissue: body.reissue,
    },
  })

  res.json({
    tax_invoice: result.invoice,
    created: result.created,
    cancelled_invoice_id: result.cancelled_invoice_id,
  })
}
