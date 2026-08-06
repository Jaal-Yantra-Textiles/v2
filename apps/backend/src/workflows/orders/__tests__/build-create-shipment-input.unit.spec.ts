import {
  buildCreateShipmentInput,
  selectFulfilledLines,
  type OrderForShipment,
} from "../shiprocket-shipment"

const baseOrder: OrderForShipment = {
  id: "order_1",
  email: "buyer@example.com",
  total: 250,
  subtotal: 250,
  metadata: {},
  shipping_address: {
    first_name: "Asha",
    last_name: "Rao",
    phone: "+919800000000",
    address_1: "12 MG Road",
    city: "Bengaluru",
    province: "KA",
    postal_code: "560001",
    country_code: "in",
  },
  items: [{ title: "Custom Saree", quantity: 2, unit_price: 100, sku: "SAR-1" }],
}

describe("buildCreateShipmentInput — phone / pincode fallbacks", () => {
  // Shiprocket 422s on empty billing_phone / billing_pincode. The buyer's phone
  // and postal code are often captured on the order/customer or billing address,
  // not the shipping address — walk shipping → billing → customer.
  const noContactShipping = {
    first_name: "Asha",
    last_name: "Rao",
    address_1: "12 MG Road",
    city: "Bengaluru",
    province: "KA",
    country_code: "in",
    // no phone, no postal_code
  }

  it("falls back phone to billing, then to the customer", () => {
    const fromBilling = buildCreateShipmentInput(
      {
        ...baseOrder,
        shipping_address: noContactShipping,
        billing_address: { phone: "+919811111111", postal_code: "560001" },
      },
      { pickupLocationName: "wh" }
    )
    expect(fromBilling.to.phone).toBe("+919811111111")

    const fromCustomer = buildCreateShipmentInput(
      {
        ...baseOrder,
        shipping_address: noContactShipping,
        billing_address: {},
        customer: { phone: "+919822222222" },
      },
      { pickupLocationName: "wh" }
    )
    expect(fromCustomer.to.phone).toBe("+919822222222")
  })

  it("falls back pincode to the billing address", () => {
    const input = buildCreateShipmentInput(
      {
        ...baseOrder,
        shipping_address: noContactShipping,
        billing_address: { postal_code: "110001" },
      },
      { pickupLocationName: "wh" }
    )
    expect(input.to.pincode).toBe("110001")
  })

  it("prefers the shipping address when it has its own phone/pincode", () => {
    const input = buildCreateShipmentInput(
      {
        ...baseOrder,
        billing_address: { phone: "+910000000000", postal_code: "000000" },
      },
      { pickupLocationName: "wh" }
    )
    expect(input.to.phone).toBe("+919800000000")
    expect(input.to.pincode).toBe("560001")
  })

  it("leaves phone/pincode empty when no source has them (guarded upstream)", () => {
    const input = buildCreateShipmentInput(
      { ...baseOrder, shipping_address: noContactShipping, billing_address: {}, customer: {} },
      { pickupLocationName: "wh" }
    )
    expect(input.to.phone).toBe("")
    expect(input.to.pincode).toBe("")
  })
})

describe("buildCreateShipmentInput (#404 PR-B)", () => {
  it("maps a prepaid order (no cod_amount)", () => {
    const input = buildCreateShipmentInput(baseOrder, {
      pickupLocationName: "warehouse-abc",
    })
    expect(input.reference_id).toBe("order_1")
    expect(input.payment_mode).toBe("prepaid")
    expect(input.cod_amount).toBeUndefined()
    expect(input.pickup_location_name).toBe("warehouse-abc")
    expect(input.to).toMatchObject({
      name: "Asha Rao",
      phone: "+919800000000",
      email: "buyer@example.com",
      address_1: "12 MG Road",
      city: "Bengaluru",
      state: "KA",
      pincode: "560001",
      country: "IN", // upper-cased
    })
    expect(input.items).toEqual([
      { name: "Custom Saree", sku: "SAR-1", quantity: 2, unit_price: 100 },
    ])
    // 200, not the fixture's `subtotal: 250` — that 250 carries shipping, and
    // the declared value is goods only (2 × 100). See "declared value excludes
    // shipping" below.
    expect(input.sub_total).toBe(200)
    expect(input.weight_grams).toBe(500) // default
  })

  it("sets cod_amount = order total for a COD order", () => {
    const input = buildCreateShipmentInput(
      { ...baseOrder, metadata: { payment_mode: "cod" } },
      { pickupLocationName: "wh" }
    )
    expect(input.payment_mode).toBe("cod")
    expect(input.cod_amount).toBe(250)
  })

  it("falls back to empty pickup name (client default) and derives sub_total", () => {
    const input = buildCreateShipmentInput(
      { ...baseOrder, subtotal: null },
      { weightGrams: 1200 }
    )
    expect(input.pickup_location_name).toBe("")
    expect(input.sub_total).toBe(200) // 2 * 100
    expect(input.weight_grams).toBe(1200)
  })

  describe("declared value excludes shipping", () => {
    // Live order order_01KXWHFP132AM0H940WFD2P0XW: item_total 241.85 +
    // shipping_total 39 = subtotal 280.85. Declaring `subtotal` put the freight
    // into the customs invoice — an inflated total that also contradicted the
    // FOB terms we state, and inflated the duty the buyer pays on arrival.
    const withShipping: OrderForShipment = {
      ...baseOrder,
      subtotal: 239, // 200 goods + 39 shipping
      item_total: 200,
      item_subtotal: 200,
    }

    it("declares the goods total, not the shipping-inclusive subtotal", () => {
      const input = buildCreateShipmentInput(withShipping, { pickupLocationName: "wh" })
      expect(input.sub_total).toBe(200)
    })

    it("keeps the declared total equal to the sum of the declared lines", () => {
      const input = buildCreateShipmentInput(withShipping, { pickupLocationName: "wh" })
      const lineSum = input.items.reduce((s, i) => s + i.unit_price * i.quantity, 0)
      expect(input.sub_total).toBe(lineSum)
    })

    it("prefers the post-discount goods total over the pre-discount one", () => {
      const input = buildCreateShipmentInput(
        { ...withShipping, item_total: 180, item_subtotal: 200 },
        { pickupLocationName: "wh" }
      )
      expect(input.sub_total).toBe(180)
    })

    it("falls back to the line sum when the goods totals are absent or zero", () => {
      for (const patch of [
        { item_total: null, item_subtotal: null },
        { item_total: 0, item_subtotal: null },
      ]) {
        const input = buildCreateShipmentInput(
          { ...withShipping, ...patch } as OrderForShipment,
          { pickupLocationName: "wh" }
        )
        expect(input.sub_total).toBe(200)
      }
    })
  })

  describe("international customs fields (#1111)", () => {
    it("passes the order currency through (declared value for intl customs)", () => {
      const input = buildCreateShipmentInput(
        { ...baseOrder, currency_code: "usd" },
        { pickupLocationName: "wh" }
      )
      expect(input.currency).toBe("USD")
    })

    it("undefined currency when the order has none", () => {
      const input = buildCreateShipmentInput(baseOrder, { pickupLocationName: "wh" })
      expect(input.currency).toBeUndefined()
    })

    it("sources HSN from the variant's hs_code", () => {
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Silk Scarf",
              quantity: 1,
              unit_price: 100,
              sku: "S-1",
              variant: { hs_code: "6214" },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("6214")
    })

    it("falls back to line metadata HSN for ad-hoc (variant-less) lines", () => {
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            { title: "Ad-hoc", quantity: 1, unit_price: 100, metadata: { hsn: "9999" } },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("9999")
    })

    it("prefers the variant hs_code over line metadata when both exist", () => {
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Both",
              quantity: 1,
              unit_price: 100,
              variant: { hs_code: "6214" },
              metadata: { hsn: "0000" },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("6214")
    })

    it("sources HSN from the variant's inventory item when the variant has none", () => {
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Managed",
              quantity: 1,
              unit_price: 100,
              variant: {
                inventory_items: [{ inventory: { hs_code: "5208" } }],
              },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("5208")
    })

    it("sources HSN from the product when neither variant nor inventory has one", () => {
      // The case the user called out: variants exist but nothing is
      // inventory-managed, so the code belongs at the product top level.
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Unmanaged",
              quantity: 1,
              unit_price: 100,
              variant: { product: { hs_code: "6117" } },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("6117")
    })

    it("takes the first non-empty inventory hs_code across several inventory items", () => {
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Kit",
              quantity: 1,
              unit_price: 100,
              variant: {
                inventory_items: [
                  { inventory: { hs_code: null } },
                  { inventory: { hs_code: "  " } },
                  { inventory: { hs_code: "5007" } },
                ],
              },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("5007")
    })

    it("applies the full precedence order variant > inventory > product > metadata", () => {
      const item = {
        title: "All four",
        quantity: 1,
        unit_price: 100,
        variant: {
          hs_code: "1111",
          inventory_items: [{ inventory: { hs_code: "2222" } }],
          product: { hs_code: "3333" },
        },
        metadata: { hsn: "4444" },
      }
      const at = (order: any) =>
        buildCreateShipmentInput(order, { pickupLocationName: "wh" }).items[0].hsn

      expect(at({ ...baseOrder, items: [item] })).toBe("1111")
      expect(
        at({
          ...baseOrder,
          items: [{ ...item, variant: { ...item.variant, hs_code: null } }],
        })
      ).toBe("2222")
      expect(
        at({
          ...baseOrder,
          items: [
            {
              ...item,
              variant: { ...item.variant, hs_code: null, inventory_items: [] },
            },
          ],
        })
      ).toBe("3333")
      expect(at({ ...baseOrder, items: [{ ...item, variant: null }] })).toBe("4444")
    })

    it("treats a blank hs_code as absent rather than letting it win", () => {
      // An empty string is truthy-adjacent enough to slip past a `??` chain if
      // it isn't trimmed — and a blank HSN fails the carrier, not the code.
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Blank",
              quantity: 1,
              unit_price: 100,
              variant: { hs_code: "   ", product: { hs_code: "6214" } },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBe("6214")
    })

    it("leaves hsn undefined when no level supplies one", () => {
      const input = buildCreateShipmentInput(
        {
          ...baseOrder,
          items: [
            {
              title: "Nothing",
              quantity: 1,
              unit_price: 100,
              variant: { hs_code: null, inventory_items: [], product: null },
            },
          ],
        },
        { pickupLocationName: "wh" }
      )
      expect(input.items[0].hsn).toBeUndefined()
    })
  })
})

/**
 * A shipment declares what's in the BOX. Declaring every order line on a partial
 * fulfillment overstated the customs value and listed goods that weren't being
 * shipped — a misdeclaration, and (for COD) a double charge at the door.
 *
 * Shapes here mirror live prod data (order_01KXWHFP132AM0H940WFD2P0XW): fulfillment
 * items carry `line_item_id` + `quantity`, and their `title` is the VARIANT name
 * ("Chrome Yellow", "S") while the order line carries the product name — so the
 * join must be on the id.
 */
describe("selectFulfilledLines", () => {
  const lines = [
    { id: "ordli_1", title: "Shirt", quantity: 3, unit_price: 50 },
    { id: "ordli_2", title: "Apron", quantity: 2, unit_price: 20 },
    { id: "ordli_3", title: "Fanny", quantity: 1, unit_price: 15 },
  ]

  it("returns every line untouched when there are no fulfillment items", () => {
    for (const fi of [undefined, null, []]) {
      const r = selectFulfilledLines(lines, fi)
      expect(r.items).toEqual(lines)
      expect(r.partial).toBe(false)
    }
  })

  it("keeps only the fulfilled lines", () => {
    const r = selectFulfilledLines(lines, [
      { line_item_id: "ordli_2", quantity: 2 },
    ])
    expect(r.items.map((i) => i.title)).toEqual(["Apron"])
    expect(r.partial).toBe(true)
  })

  it("uses the fulfilled quantity, not the ordered quantity", () => {
    // One line shipped across two boxes: this box has 1 of the 3 ordered.
    const r = selectFulfilledLines(lines, [
      { line_item_id: "ordli_1", quantity: 1 },
    ])
    expect(r.items[0]).toMatchObject({ title: "Shirt", quantity: 1 })
    expect(r.partial).toBe(true)
  })

  it("is not partial when the fulfillment covers every line at full quantity", () => {
    const r = selectFulfilledLines(lines, [
      { line_item_id: "ordli_1", quantity: 3 },
      { line_item_id: "ordli_2", quantity: 2 },
      { line_item_id: "ordli_3", quantity: 1 },
    ])
    expect(r.items).toHaveLength(3)
    expect(r.partial).toBe(false)
  })

  it("ignores fulfillment items that match no order line", () => {
    const r = selectFulfilledLines(lines, [
      { line_item_id: "ordli_2", quantity: 2 },
      { line_item_id: "ordli_gone", quantity: 9 },
    ])
    expect(r.items.map((i) => i.title)).toEqual(["Apron"])
  })

  it("falls back to all lines when NOTHING resolves, never an empty declaration", () => {
    // A missing field selection must degrade to the old behaviour, not ship a
    // box declaring zero goods.
    const r = selectFulfilledLines(lines, [{ line_item_id: null, quantity: 1 }])
    expect(r.items).toEqual(lines)
    expect(r.partial).toBe(false)
  })

  it("keeps the ordered quantity when the fulfilled one is missing or junk", () => {
    for (const quantity of [null, 0, undefined] as any[]) {
      const r = selectFulfilledLines(lines, [
        { line_item_id: "ordli_1", quantity },
      ])
      expect(r.items[0].quantity).toBe(3)
    }
  })
})

describe("buildCreateShipmentInput — partial fulfillment", () => {
  const order: OrderForShipment = {
    id: "order_1",
    email: "buyer@example.com",
    total: 300,
    subtotal: 300,
    item_total: 261,
    item_subtotal: 261,
    metadata: {},
    shipping_address: {
      first_name: "Asha",
      phone: "+919800000000",
      address_1: "12 MG Road",
      city: "Bengaluru",
      province: "KA",
      postal_code: "560001",
      country_code: "in",
    },
    items: [
      { id: "ordli_1", title: "Shirt", quantity: 3, unit_price: 50, sku: "SH-1" },
      { id: "ordli_2", title: "Apron", quantity: 2, unit_price: 20, sku: "AP-1" },
    ],
  }

  it("declares only the shipped line, at the shipped quantity and value", () => {
    const input = buildCreateShipmentInput(order, {
      pickupLocationName: "wh",
      fulfillmentItems: [{ line_item_id: "ordli_2", quantity: 1 }],
    })
    expect(input.items).toEqual([
      { name: "Apron", sku: "AP-1", quantity: 1, unit_price: 20, hsn: undefined },
    ])
    // 20, NOT the order's item_total of 261.
    expect(input.sub_total).toBe(20)
  })

  it("ignores the order-level goods total on a partial shipment", () => {
    const input = buildCreateShipmentInput(order, {
      pickupLocationName: "wh",
      fulfillmentItems: [{ line_item_id: "ordli_1", quantity: 2 }],
    })
    expect(input.sub_total).toBe(100) // 2 × 50
    expect(input.sub_total).not.toBe(261)
  })

  it("still prefers the order goods total when the whole order ships", () => {
    const input = buildCreateShipmentInput(order, {
      pickupLocationName: "wh",
      fulfillmentItems: [
        { line_item_id: "ordli_1", quantity: 3 },
        { line_item_id: "ordli_2", quantity: 2 },
      ],
    })
    // 261 (post-discount goods) rather than the 190 the raw lines sum to.
    expect(input.sub_total).toBe(261)
  })

  it("collects COD for this box only, never the whole order twice", () => {
    const input = buildCreateShipmentInput(
      { ...order, metadata: { payment_mode: "cod" } },
      {
        pickupLocationName: "wh",
        fulfillmentItems: [{ line_item_id: "ordli_2", quantity: 1 }],
      }
    )
    expect(input.payment_mode).toBe("cod")
    expect(input.cod_amount).toBe(20)
    expect(input.cod_amount).not.toBe(300)
  })

  it("still collects the full order total when everything ships together", () => {
    const input = buildCreateShipmentInput(
      { ...order, metadata: { payment_mode: "cod" } },
      {
        pickupLocationName: "wh",
        fulfillmentItems: [
          { line_item_id: "ordli_1", quantity: 3 },
          { line_item_id: "ordli_2", quantity: 2 },
        ],
      }
    )
    expect(input.cod_amount).toBe(300)
  })
})
