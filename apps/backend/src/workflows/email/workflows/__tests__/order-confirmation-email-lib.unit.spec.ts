import {
  confirmationDelivery,
  confirmationLines,
  confirmationPayment,
  confirmationTotals,
  paymentMethodWords,
  readAmount,
} from "../order-confirmation-email-lib"

// Shape of order #158 as prod returned it on 2026-11-22 (trimmed).
const order158 = {
  currency_code: "inr",
  total: 1.05,
  item_subtotal: 1,
  tax_total: 0.05,
  shipping_total: 0,
  discount_total: 0,
  summary: { paid_total: 1.05 },
  items: [
    {
      title: "Unlined & Unhurried Kurta",
      thumbnail: "https://automatic.jaalyantra.com/k.webp",
      unit_price: 1,
      quantity: 1,
      subtotal: 1,
      metadata: { design_id: "01M7RRA9XAFNZE94DNGHEGZHDZ" },
    },
  ],
  shipping_address: { country_code: "in" },
  shipping_methods: [],
  payment_collections: [
    {
      captured_amount: 1.05,
      authorized_amount: 1.05,
      payments: [{ provider_id: "pp_payu_payu", data: { mode: "UPI" } }],
    },
  ],
}

describe("order confirmation details (#2578)", () => {
  it("lists each piece with price; drops a line with no readable price", () => {
    const lines = confirmationLines(
      [...order158.items, { title: "No price", unit_price: null, quantity: 1 }],
      "inr"
    )
    expect(lines).toEqual([
      expect.objectContaining({ title: "Unlined & Unhurried Kurta", quantity: 1, unit_price: "₹1.00", line_total: "₹1.00" }),
    ])
  })

  it("hides a 'Default' variant title and keeps a real one", () => {
    const [a, b] = confirmationLines(
      [
        { title: "Robe", variant_title: "Default", unit_price: 10, quantity: 1 },
        { title: "Robe", variant_title: "M / Indigo", unit_price: 10, quantity: 2 },
      ],
      "inr"
    )
    expect(a.variant).toBeNull()
    expect(b.variant).toBe("M / Indigo")
    expect(b.line_total).toBe("₹20.00")
  })

  it("shows only the totals rows that are real, non-zero amounts", () => {
    expect(confirmationTotals(order158)).toEqual({
      subtotal: "₹1.00",
      shipping_total: null,
      tax_total: "₹0.05",
      discount_total: null,
    })
  })

  it("says what was paid and how — the live UPI order", () => {
    expect(confirmationPayment(order158)).toEqual({
      paid: "₹1.05",
      method: "UPI via PayU",
      balance_due: null,
      paid_in_full: true,
    })
  })

  it("shows the balance still due on a deposit order", () => {
    const deposit = {
      ...order158,
      total: 10000,
      summary: { paid_total: 3000 },
      payment_collections: [{ captured_amount: 3000, payments: [{ provider_id: "pp_system_default" }] }],
    }
    expect(confirmationPayment(deposit)).toMatchObject({
      paid: "₹3,000.00",
      method: "bank transfer",
      balance_due: "₹7,000.00",
      paid_in_full: false,
    })
  })

  it("counts an authorised-not-yet-captured payment as paid (storefront checkout)", () => {
    const authorised = {
      ...order158,
      summary: { paid_total: 0 },
      payment_collections: [{ captured_amount: 0, authorized_amount: 1.05, payments: [{ provider_id: "pp_stripe_stripe" }] }],
    }
    expect(confirmationPayment(authorised)).toMatchObject({ paid: "₹1.05", method: "card via Stripe", paid_in_full: true })
  })

  it("never invents a payment: nothing held → no paid row, the whole total due", () => {
    const unpaid = { ...order158, summary: {}, payment_collections: [] }
    expect(confirmationPayment(unpaid)).toEqual({
      paid: null,
      method: null,
      balance_due: "₹1.05",
      paid_in_full: false,
    })
  })

  it("names PayU methods in buyer words", () => {
    expect(paymentMethodWords({ provider_id: "pp_payu_payu", data: { mode: "NB" } })).toBe("net banking via PayU")
    expect(paymentMethodWords({ provider_id: "pp_payu_payu", data: {} })).toBe("PayU")
    expect(paymentMethodWords(null)).toBeNull()
  })

  it("delivery: a design-only order is made to order; a bare country is not an address", () => {
    expect(confirmationDelivery(order158)).toEqual({ method: null, address_lines: [], made_to_order: true })
  })

  it("delivery: shipping method and a full address as lines", () => {
    const shipped = {
      items: [{ title: "Scarf", metadata: {} }],
      shipping_methods: [{ name: "Standard shipping" }],
      shipping_address: {
        first_name: "Asha",
        last_name: "Rao",
        address_1: "12 MG Road",
        city: "Bengaluru",
        province: "KA",
        postal_code: "560001",
        country_code: "in",
      },
    }
    expect(confirmationDelivery(shipped)).toEqual({
      method: "Standard shipping",
      address_lines: ["Asha Rao", "12 MG Road", "Bengaluru, KA, 560001", "IN"],
      made_to_order: false,
    })
  })

  it("readAmount never turns null into 0", () => {
    expect(readAmount(null)).toBeNull()
    expect(readAmount(undefined)).toBeNull()
    expect(readAmount("")).toBeNull()
    expect(readAmount(0)).toBe(0)
    expect(readAmount({ value: "1.05" })).toBe(1.05)
  })
})
