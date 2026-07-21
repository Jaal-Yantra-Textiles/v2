import {
  buildCreateShipmentInput,
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
    expect(input.sub_total).toBe(250)
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
  })
})
