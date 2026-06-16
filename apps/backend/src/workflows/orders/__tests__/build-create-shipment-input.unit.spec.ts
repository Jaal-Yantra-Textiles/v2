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
})
