import { buildOrderTaxInvoiceModel } from "../order-tax-invoice-model"
import { buildTaxInvoiceEmailVars } from "../send-tax-invoice-email"

const doc = (paid: number) =>
  buildOrderTaxInvoiceModel({
    invoice_number: "JYT/2026-27/0007",
    invoice_date: "2026-11-09T10:00:00Z",
    order: { id: "o", display_id: 148, created_at: null, currency_code: "inr", total: 2100, paid_total: paid },
    seller: { legal_name: "JYT", gstin: "02X", address: { name: "JYT", lines: [], state: "Himachal Pradesh", postal_code: "176215", country_code: "in" } },
    bill_to: null,
    ship_to: null,
    lines: [{ title: "Stole", quantity: 2, total: 2100, tax_total: 100, tax_rate: 5 }],
    charges: [],
  })

describe("buildTaxInvoiceEmailVars (#2532)", () => {
  it("fills the order-tax-invoice template", () => {
    const v = buildTaxInvoiceEmailVars(doc(0), "Priya")
    expect(v).toMatchObject({
      customer_first_name: "Priya",
      order_display_id: "148",
      invoice_number: "JYT/2026-27/0007",
      invoice_date: "09 Nov 2026",
    })
    expect(v.grand_total).toContain("2,100.00")
    expect(v.balance_due).toContain("2,100.00")
  })

  it("leaves balance_due empty when fully paid, and greets a nameless buyer", () => {
    const v = buildTaxInvoiceEmailVars(doc(2100), null)
    expect(v.balance_due).toBe("")
    expect(v.customer_first_name).toBe("there")
  })
})
