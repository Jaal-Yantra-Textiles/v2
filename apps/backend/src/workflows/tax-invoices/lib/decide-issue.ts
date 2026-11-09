import type { OrderTaxInvoiceModel } from "../../../lib/invoices/order-tax-invoice-model"

/**
 * What issuing a tax invoice should do, given the order's current invoice
 * (#2532). PURE.
 *
 * 🔑 Issuing is idempotent: asking twice for an unchanged order returns the
 * same invoice, never a second number. A changed order is NOT silently
 * re-billed — the caller must say `reissue`, which cancels the old invoice
 * (kept, marked cancelled) and issues a new one.
 */
export type IssueDecision =
  | { action: "reuse"; invoice_id: string }
  | { action: "issue"; cancel_invoice_id: string | null }
  | { action: "refuse"; reason: string }

/**
 * The billable content of an invoice — everything but number and dates.
 *
 * The seller is part of it: a corrected registered address or GSTIN is a
 * different bill (#2532 — Cherry's 0001/0002 went out with a placeholder
 * address and had to be reissued), so it must be able to trigger a reissue.
 */
export function invoiceFingerprint(model: OrderTaxInvoiceModel): string {
  return JSON.stringify({
    seller: model.seller,
    rows: model.rows.map((r) => [r.description, r.hsn, r.quantity, r.taxable, r.cgst, r.sgst, r.igst]),
    totals: [model.totals.taxable, model.totals.tax, model.totals.grand_total],
    supply: model.supply_type,
    bill_to: model.bill_to,
    ship_to: model.ship_to,
    buyer_gstin: model.buyer_gstin,
    currency: model.currency_code,
  })
}

export function decideIssue(
  current: { id: string; invoice_number: string; document: OrderTaxInvoiceModel } | null,
  next: OrderTaxInvoiceModel,
  opts: { reissue?: boolean }
): IssueDecision {
  if (!current) return { action: "issue", cancel_invoice_id: null }

  if (invoiceFingerprint(current.document) === invoiceFingerprint(next)) {
    return { action: "reuse", invoice_id: current.id }
  }

  if (!opts.reissue) {
    return {
      action: "refuse",
      reason: `Order changed since invoice ${current.invoice_number} was issued. Pass reissue: true to cancel it and issue a new one.`,
    }
  }

  return { action: "issue", cancel_invoice_id: current.id }
}
