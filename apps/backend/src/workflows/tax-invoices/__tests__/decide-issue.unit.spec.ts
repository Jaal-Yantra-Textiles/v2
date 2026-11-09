import { buildOrderTaxInvoiceModel, type OrderTaxInvoiceInput } from "../../../lib/invoices/order-tax-invoice-model"
import { decideIssue } from "../lib/decide-issue"

const base: OrderTaxInvoiceInput = {
  invoice_number: null,
  invoice_date: "2026-11-09",
  order: { id: "order_1", display_id: 1, created_at: null, currency_code: "inr", total: 105, paid_total: 0 },
  seller: {
    legal_name: "JYT",
    gstin: "02X",
    address: { name: "JYT", lines: [], state: "Himachal Pradesh", postal_code: "176215", country_code: "in" },
  },
  bill_to: null,
  ship_to: null,
  lines: [{ title: "Scarf", quantity: 1, total: 105, tax_total: 5, tax_rate: 5 }],
  charges: [],
}

const issued = (over: Partial<OrderTaxInvoiceInput> = {}) => ({
  id: "tinv_1",
  invoice_number: "JYT/2026-27/0001",
  document: buildOrderTaxInvoiceModel({ ...base, invoice_number: "JYT/2026-27/0001", ...over }),
})

describe("decideIssue", () => {
  it("issues when the order has no invoice", () => {
    expect(decideIssue(null, buildOrderTaxInvoiceModel(base), {})).toEqual({
      action: "issue",
      cancel_invoice_id: null,
    })
  })

  it("reuses the invoice for an unchanged order, whatever the date", () => {
    const next = buildOrderTaxInvoiceModel({ ...base, invoice_date: "2026-12-01" })
    expect(decideIssue(issued(), next, {})).toEqual({ action: "reuse", invoice_id: "tinv_1" })
  })

  it("refuses to re-bill a changed order without reissue", () => {
    const next = buildOrderTaxInvoiceModel({
      ...base,
      order: { ...base.order, total: 210 },
      lines: [{ ...base.lines[0], quantity: 2, total: 210, tax_total: 10 }],
    })
    const d = decideIssue(issued(), next, {})
    expect(d.action).toBe("refuse")
    expect((d as any).reason).toContain("JYT/2026-27/0001")
  })

  it("reuses an invoice read back from jsonb with its keys reordered", () => {
    // Postgres jsonb sorts keys by length then bytes; reproduce that order.
    const jsonbOrder = (v: any): any =>
      Array.isArray(v)
        ? v.map(jsonbOrder)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
                .map(([k, x]) => [k, jsonbOrder(x)])
            )
          : v
    const stored = issued()
    const readBack = { ...stored, document: jsonbOrder(JSON.parse(JSON.stringify(stored.document))) }
    expect(Object.keys(readBack.document.seller)).toEqual(["gstin", "lines", "legal_name"])

    expect(decideIssue(readBack, buildOrderTaxInvoiceModel(base), {})).toEqual({
      action: "reuse",
      invoice_id: "tinv_1",
    })
  })

  it("treats a corrected seller address as a change that needs a reissue", () => {
    const corrected = buildOrderTaxInvoiceModel({
      ...base,
      seller: { ...base.seller, address: { ...base.seller.address, lines: ["1/2300A Mandoli Road"] } },
    })
    expect(decideIssue(issued(), corrected, {}).action).toBe("refuse")
    expect(decideIssue(issued(), corrected, { reissue: true })).toEqual({
      action: "issue",
      cancel_invoice_id: "tinv_1",
    })
  })

  it("cancels the old invoice and issues a new one on reissue", () => {
    const next = buildOrderTaxInvoiceModel({ ...base, buyer_gstin: "29ABC" })
    expect(decideIssue(issued(), next, { reissue: true })).toEqual({
      action: "issue",
      cancel_invoice_id: "tinv_1",
    })
  })
})
