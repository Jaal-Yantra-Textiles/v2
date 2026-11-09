import type { MedusaContainer } from "@medusajs/framework/types"

import { TAX_INVOICE_MODULE } from "../../modules/tax_invoice"
import type TaxInvoiceService from "../../modules/tax_invoice/service"
import type { EmailAttachment } from "../../workflows/email/types"
import { invoiceFingerprint } from "../../workflows/tax-invoices/lib/decide-issue"
import { gatherOrderTaxInvoice } from "./gather-order-tax-invoice"
import {
  buildOrderTaxInvoiceModel,
  type OrderTaxInvoiceModel,
} from "./order-tax-invoice-model"
import { renderOrderTaxInvoicePdf } from "./render-order-tax-invoice"

export type TaxInvoiceAttachment =
  | { attach: true; invoice_number: string; attachment: EmailAttachment }
  | { attach: false; reason: string }

/**
 * The order's current GST tax invoice as an email attachment (#2532), or why
 * there is none.
 *
 * 🔑 Attached only when it still matches the order. An invoice issued before an
 * edit is a bill for something else; sending it would hand the customer a
 * document that disagrees with the email it arrives in. The email still goes —
 * it carries the live figures — and the caller reports why nothing was attached.
 */
export async function currentTaxInvoiceAttachment(
  container: MedusaContainer,
  orderId: string
): Promise<TaxInvoiceAttachment> {
  const service: TaxInvoiceService = container.resolve(TAX_INVOICE_MODULE)
  const [current] = await service.listTaxInvoices(
    { order_id: orderId, status: "issued" },
    { order: { issued_at: "DESC" }, take: 1 }
  )
  if (!current) {
    return { attach: false, reason: "No tax invoice issued for this order yet." }
  }

  const document = current.document as unknown as OrderTaxInvoiceModel
  try {
    const live = buildOrderTaxInvoiceModel(
      await gatherOrderTaxInvoice(container, orderId, {
        invoice_number: null,
        invoice_date: new Date().toISOString(),
        buyer_gstin: document.buyer_gstin,
      })
    )
    if (invoiceFingerprint(live) !== invoiceFingerprint(document)) {
      return {
        attach: false,
        reason: `Order changed since ${current.invoice_number}; reissue the tax invoice to attach it.`,
      }
    }
  } catch (e: any) {
    return { attach: false, reason: e?.message ?? "Could not check the tax invoice." }
  }

  const pdf = await renderOrderTaxInvoicePdf(document)
  return {
    attach: true,
    invoice_number: current.invoice_number,
    attachment: {
      filename: `${current.invoice_number.replace(/\//g, "-")}.pdf`,
      content: Buffer.from(pdf).toString("base64"),
      content_type: "application/pdf",
    },
  }
}
