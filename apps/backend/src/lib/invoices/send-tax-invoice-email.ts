import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { TAX_INVOICE_MODULE } from "../../modules/tax_invoice"
import type TaxInvoiceService from "../../modules/tax_invoice/service"
import { sendNotificationEmailWorkflow } from "../../workflows/email/workflows/send-notification-email"
import type { OrderTaxInvoiceModel } from "./order-tax-invoice-model"
import { currentTaxInvoiceAttachment } from "./tax-invoice-attachment"

export const ORDER_TAX_INVOICE_TEMPLATE = "order-tax-invoice"

export type TaxInvoiceEmailVars = {
  customer_first_name: string
  order_display_id: string
  invoice_number: string
  invoice_date: string
  taxable: string
  tax: string
  grand_total: string
  paid: string
  /** Empty when fully paid, so the template's {{#if}} reads it as paid. */
  balance_due: string
  current_year: string
}

const fmt = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency.toUpperCase() }).format(
    Number(amount ?? 0)
  )

/** PURE: what the `order-tax-invoice` template is filled with. */
export function buildTaxInvoiceEmailVars(
  doc: OrderTaxInvoiceModel,
  customerFirstName: string | null
): TaxInvoiceEmailVars {
  const c = doc.currency_code
  const t = doc.totals
  return {
    customer_first_name: customerFirstName?.trim() || "there",
    order_display_id: doc.order_ref.replace(/^#/, ""),
    invoice_number: doc.invoice_number ?? "",
    invoice_date: new Date(doc.invoice_date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    taxable: fmt(t.taxable, c),
    tax: fmt(t.tax, c),
    grand_total: fmt(t.grand_total, c),
    paid: fmt(t.paid, c),
    balance_due: t.balance_due > 0 ? fmt(t.balance_due, c) : "",
    current_year: String(new Date().getFullYear()),
  }
}

export type SendTaxInvoiceEmailResult = {
  sent: boolean
  preview: boolean
  to: string
  invoice_number: string
  attachment: string
  vars: TaxInvoiceEmailVars
}

/**
 * Email one issued GST tax invoice to the buyer through the `order-tax-invoice`
 * email template, with its PDF attached (#2532).
 *
 * Refuses a cancelled invoice, and one that is no longer the order's current
 * bill or no longer matches the order — reissue first. `preview` sends nothing.
 */
export async function sendTaxInvoiceEmail(
  container: MedusaContainer,
  input: { invoice_id: string; preview?: boolean }
): Promise<SendTaxInvoiceEmailResult> {
  const service: TaxInvoiceService = container.resolve(TAX_INVOICE_MODULE)
  const [invoice] = await service.listTaxInvoices({ id: input.invoice_id }, { take: 1 })
  if (!invoice) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Tax invoice ${input.invoice_id} not found`)
  }
  if (invoice.status !== "issued") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${invoice.invoice_number} is cancelled (${invoice.cancel_reason ?? "no reason"}). Send the current invoice instead.`
    )
  }

  const current = await currentTaxInvoiceAttachment(container, invoice.order_id)
  if (!current.attach) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, current.reason)
  }
  if (current.invoice_number !== invoice.invoice_number) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${invoice.invoice_number} is not the order's current invoice (${current.invoice_number} is).`
    )
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "email", "customer.first_name", "shipping_address.first_name", "billing_address.first_name"],
    filters: { id: invoice.order_id },
  })
  const order = (orders ?? [])[0]
  if (!order?.email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order ${invoice.order_id} has no email address to send the invoice to.`
    )
  }

  const vars = buildTaxInvoiceEmailVars(
    invoice.document as unknown as OrderTaxInvoiceModel,
    order.customer?.first_name ??
      order.billing_address?.first_name ??
      order.shipping_address?.first_name ??
      null
  )
  const result = {
    to: order.email as string,
    invoice_number: invoice.invoice_number,
    attachment: current.attachment.filename,
    vars,
  }

  if (input.preview) {
    return { sent: false, preview: true, ...result }
  }

  await sendNotificationEmailWorkflow(container).run({
    input: {
      to: order.email,
      template: ORDER_TAX_INVOICE_TEMPLATE,
      data: vars as unknown as Record<string, any>,
      attachments: [current.attachment],
    },
  })

  return { sent: true, preview: false, ...result }
}
