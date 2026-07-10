import { mapFaireOrderToOrder, faireMoney } from "../workflows/ingest-faire-order-support"

describe("faireMoney", () => {
  it("converts integer cents to decimal major units", () => {
    expect(faireMoney(2500)).toBe(25)
    expect(faireMoney(4999)).toBe(49.99)
  })
  it("coerces undefined/NaN to 0", () => {
    expect(faireMoney(undefined)).toBe(0)
    expect(faireMoney(NaN)).toBe(0)
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
    expect(mapped.total).toBe(49.99)
    expect(mapped.buyer_name).toBe("Ada Lovelace")
    expect(mapped.email).toBe("faire+o_123@marketplace.invalid")
    expect(mapped.shipping_address.country_code).toBe("gb")
    expect(mapped.items).toHaveLength(1)
    expect(mapped.items[0]).toMatchObject({
      title: "Cushion",
      quantity: 2,
      unit_price: 12.5,
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

  it("maps a real ExternalOrderV2 (customer/address/item.price, no top-level total)", () => {
    const order = {
      id: "bo_bxdmjbwxid",
      state: "NEW",
      customer: { first_name: "John", last_name: "Smith" },
      address: {
        name: "John Smith",
        company_name: "Faire Wholesale, Inc",
        address1: "41 King Street West",
        address2: "3rd Floor",
        city: "Kitchener",
        state: "Ontario",
        state_code: "ON",
        postal_code: "N2G 1A1",
        country: "Canada",
        country_code: "CAN",
        phone_number: "555-123-4567",
      },
      items: [
        {
          id: "oi_bq425ju5vh",
          product_id: "p_fccaefnahr",
          variant_id: "po_3745tjzrpc",
          sku: "goldenretriever",
          quantity: 2,
          product_name: "Golden Dog",
          price: { amount_minor: 4999, currency: "USD" },
        },
      ],
      payout_costs: { total_payout: { amount_minor: 8000, currency: "USD" } },
    }

    const mapped = mapFaireOrderToOrder(order)

    expect(mapped.order_token).toBe("bo_bxdmjbwxid")
    expect(mapped.currency_code).toBe("usd")
    // no order-level total → sum of line values: 49.99 × 2
    expect(mapped.total).toBe(99.98)
    expect(mapped.buyer_name).toBe("John Smith")
    expect(mapped.shipping_address).toMatchObject({
      first_name: "John",
      last_name: "Smith",
      company: "Faire Wholesale, Inc",
      address_1: "41 King Street West",
      address_2: "3rd Floor",
      city: "Kitchener",
      province: "ON",
      postal_code: "N2G 1A1",
      country_code: "ca", // ISO-3 CAN → ISO-2 ca
      phone: "555-123-4567",
    })
    expect(mapped.items[0]).toMatchObject({
      title: "Golden Dog",
      quantity: 2,
      unit_price: 49.99,
    })
    expect(mapped.items[0].metadata).toMatchObject({
      faire_product_token: "p_fccaefnahr",
      faire_variant_id: "po_3745tjzrpc",
      faire_sku: "goldenretriever",
    })
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
