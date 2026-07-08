import { mapFaireOrderToOrder, faireMoneyCents } from "../workflows/ingest-faire-order-support"

describe("faireMoneyCents", () => {
  it("passes through finite integers", () => {
    expect(faireMoneyCents(2500)).toBe(2500)
  })
  it("coerces undefined/NaN to 0", () => {
    expect(faireMoneyCents(undefined)).toBe(0)
    expect(faireMoneyCents(NaN)).toBe(0)
  })
})

describe("mapFaireOrderToOrder", () => {
  it("maps items, address and idempotency token", () => {
    const order = {
      order_token: "o_123",
      currency: "USD",
      total_cents: 4999,
      buyer_name: "Ada Lovelace",
      address: {
        first_name: "Ada",
        last_name: "Lovelace",
        street1: "1 Main St",
        city: "London",
        state: "ENG",
        zip: "EC1",
        country: "GB",
      },
      items: [
        {
          id: "i_1",
          product_token: "p_1",
          sku: "SKU-1",
          quantity: 2,
          wholesale_price_cents: 1250,
          name: "Cushion",
        },
      ],
    }

    const mapped = mapFaireOrderToOrder(order)

    expect(mapped.order_token).toBe("o_123")
    expect(mapped.currency_code).toBe("usd")
    expect(mapped.total).toBe(4999)
    expect(mapped.buyer_name).toBe("Ada Lovelace")
    expect(mapped.email).toBe("faire+o_123@marketplace.invalid")
    expect(mapped.shipping_address.country_code).toBe("gb")
    expect(mapped.items).toHaveLength(1)
    expect(mapped.items[0]).toMatchObject({
      title: "Cushion",
      quantity: 2,
      unit_price: 1250,
    })
    expect(mapped.items[0].metadata).toMatchObject({
      faire_order_token: "o_123",
      faire_product_token: "p_1",
      faire_sku: "SKU-1",
    })
  })

  it("falls back when address fields are missing", () => {
    const mapped = mapFaireOrderToOrder({ order_token: "o_1", items: [] })
    expect(mapped.shipping_address.first_name).toBe("Faire")
    expect(mapped.items).toEqual([])
  })

  it("uses buyer email when provided", () => {
    const mapped = mapFaireOrderToOrder({
      order_token: "o_2",
      buyer_email: "retailer@example.com",
      items: [{ quantity: 1, name: "x" }],
    })
    expect(mapped.email).toBe("retailer@example.com")
  })
})
