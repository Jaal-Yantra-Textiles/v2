import { etsyMoney, mapReceiptToOrder } from "../workflows/ingest-etsy-order-support"

describe("etsyMoney", () => {
  it("divides amount by divisor to a whole-currency decimal", () => {
    expect(etsyMoney({ amount: 12000, divisor: 100 })).toBe(120)
    expect(etsyMoney({ amount: 12050, divisor: 100 })).toBe(120.5)
  })
  it("defaults divisor to 100 and handles missing money", () => {
    expect(etsyMoney({ amount: 500 })).toBe(5)
    expect(etsyMoney(undefined)).toBe(0)
  })
})

describe("mapReceiptToOrder", () => {
  const receipt = {
    receipt_id: 987654,
    name: "Jane Doe",
    first_line: "1 Main St",
    city: "Portland",
    state: "OR",
    zip: "97201",
    country_iso: "US",
    currency_code: "USD",
    grandtotal: { amount: 12550, divisor: 100, currency_code: "USD" },
    transactions: [
      {
        transaction_id: 1,
        title: "Hand-dyed scarf",
        quantity: 2,
        price: { amount: 6000, divisor: 100 },
        listing_id: 555,
        product_id: 777,
        sku: "SCARF-1",
      },
    ],
  }

  it("maps transactions to whole-currency custom line items", () => {
    const m = mapReceiptToOrder(receipt)
    expect(m.receipt_id).toBe("987654")
    expect(m.currency_code).toBe("usd")
    expect(m.total).toBe(125.5)
    expect(m.items).toHaveLength(1)
    expect(m.items[0]).toMatchObject({
      title: "Hand-dyed scarf",
      quantity: 2,
      unit_price: 60,
    })
    expect(m.items[0].metadata.etsy_listing_id).toBe("555")
  })

  it("synthesizes a non-deliverable email and splits the name", () => {
    const m = mapReceiptToOrder(receipt)
    expect(m.email).toBe("etsy+987654@marketplace.invalid")
    expect(m.shipping_address.first_name).toBe("Jane")
    expect(m.shipping_address.last_name).toBe("Doe")
    expect(m.shipping_address.country_code).toBe("us")
  })

  it("prefers a real buyer_email if Etsy provides one", () => {
    const m = mapReceiptToOrder({ ...receipt, buyer_email: "jane@example.com" })
    expect(m.email).toBe("jane@example.com")
  })
})
