import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { TAX_INVOICE_MODULE } from "../../../../../modules/tax_invoice"
import type TaxInvoiceService from "../../../../../modules/tax_invoice/service"
import type { OrderTaxInvoiceModel } from "../../../../../lib/invoices/order-tax-invoice-model"
import { renderOrderTaxInvoicePdf } from "../../../../../lib/invoices/render-order-tax-invoice"

/**
 * GET /admin/tax-invoices/:id/pdf
 *
 * The issued invoice as a PDF, drawn from its FROZEN document — never the live
 * order — so a reprint is the same bill the customer received (#2532). A
 * cancelled invoice still prints, stamped as such in the filename.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: TaxInvoiceService = req.scope.resolve(TAX_INVOICE_MODULE)
  const [invoice] = await service.listTaxInvoices({ id: req.params.id }, { take: 1 })
  if (!invoice) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Tax invoice ${req.params.id} not found`)
  }

  const pdf = await renderOrderTaxInvoicePdf(
    invoice.document as unknown as OrderTaxInvoiceModel
  )
  const file = `${invoice.invoice_number.replace(/\//g, "-")}${
    invoice.status === "cancelled" ? "-CANCELLED" : ""
  }.pdf`

  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `inline; filename="${file}"`)
  res.end(Buffer.from(pdf))
}
