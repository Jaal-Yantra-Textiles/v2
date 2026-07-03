import {
  buildInventoryOrderShipmentInput,
  DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS,
  missingDestinationAddressFields,
  resolveInventoryDestinationAddress,
  type InventoryOrderForShipment,
} from "../lib/inventory-order-shipment"

const baseOrder: InventoryOrderForShipment = {
  id: "invord_1",
  total_price: 1200,
  metadata: {},
  shipping_address: {
    first_name: "JYT",
    last_name: "Warehouse",
    phone: "9990001111",
    address_1: "12 Loom St",
    city: "Delhi",
    province: "DL",
    postal_code: "110001",
    country_code: "in",
  },
  orderlines: [
    { id: "ol_1", quantity: 10, price: 50, metadata: { title: "Cotton yarn", sku: "CY-1" } },
    { id: "ol_2", quantity: 4, price: 100, metadata: { name: "Dye" } },
  ],
}

describe("buildInventoryOrderShipmentInput (#772)", () => {
  it("maps address, items and totals; defaults prepaid + weight + uppercased country", () => {
    const input = buildInventoryOrderShipmentInput(baseOrder, { pickupLocationName: "warehouse-abc12345" })
    expect(input.reference_id).toBe("invord_1")
    expect(input.payment_mode).toBe("prepaid")
    expect(input.cod_amount).toBeUndefined()
    expect(input.pickup_location_name).toBe("warehouse-abc12345")
    expect(input.weight_grams).toBe(DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS)
    expect(input.to).toMatchObject({
      name: "JYT Warehouse",
      phone: "9990001111",
      address_1: "12 Loom St",
      city: "Delhi",
      state: "DL",
      pincode: "110001",
      country: "IN",
    })
    expect(input.items).toEqual([
      { name: "Cotton yarn", sku: "CY-1", quantity: 10, unit_price: 50 },
      { name: "Dye", sku: undefined, quantity: 4, unit_price: 100 },
    ])
    expect(input.sub_total).toBe(1200) // total_price wins when present
  })

  it("restricts items/quantities to delivered lines and drops zero-qty lines", () => {
    const input = buildInventoryOrderShipmentInput(baseOrder, {
      pickupLocationName: "wh",
      deliveredQuantities: { ol_1: 6, ol_2: 0 },
    })
    expect(input.items).toEqual([
      { name: "Cotton yarn", sku: "CY-1", quantity: 6, unit_price: 50 },
    ])
  })

  it("computes sub_total from items when total_price is absent", () => {
    const input = buildInventoryOrderShipmentInput(
      { ...baseOrder, total_price: null },
      { pickupLocationName: "wh" }
    )
    expect(input.sub_total).toBe(10 * 50 + 4 * 100)
  })

  it("emits a COD amount when payment_mode is cod", () => {
    const input = buildInventoryOrderShipmentInput(
      { ...baseOrder, metadata: { payment_mode: "cod" } },
      { pickupLocationName: "wh" }
    )
    expect(input.payment_mode).toBe("cod")
    expect(input.cod_amount).toBe(1200)
  })

  it("falls back to a default pickup ('') and 'Warehouse' name / IN country on a bare order", () => {
    const input = buildInventoryOrderShipmentInput({ id: "x", orderlines: [] })
    expect(input.pickup_location_name).toBe("")
    expect(input.to.name).toBe("Warehouse")
    expect(input.to.country).toBe("IN")
    expect(input.items).toEqual([])
  })
})

describe("resolveInventoryDestinationAddress (#772 to-location fill)", () => {
  const locAddress = {
    address_1: "9 Mill Rd",
    city: "Surat",
    province: "GJ",
    postal_code: "395003",
    country_code: "in",
    phone: "8887776665",
  }

  it("fills a sparse shipping_address from the to-location stock-location address", () => {
    const resolved = resolveInventoryDestinationAddress(
      { city: "Delhi", country_code: "in" }, // typical minimal blob
      locAddress,
      "Surat Warehouse"
    )
    expect(resolved.address_1).toBe("9 Mill Rd")
    expect(resolved.postal_code).toBe("395003")
    expect(resolved.phone).toBe("8887776665")
    // explicit shipping_address value wins over the location value
    expect(resolved.city).toBe("Delhi")
    // no contact name → fall back to the location name
    expect(resolved.first_name).toBe("Surat Warehouse")
    expect(missingDestinationAddressFields(resolved)).toEqual([])
  })

  it("keeps explicit shipping_address contact fields over the location name", () => {
    const resolved = resolveInventoryDestinationAddress(
      { first_name: "Amit", phone: "9001112223" },
      locAddress,
      "Surat Warehouse"
    )
    expect(resolved.first_name).toBe("Amit")
    expect(resolved.phone).toBe("9001112223")
    expect(resolved.address_1).toBe("9 Mill Rd")
  })

  it("reports the specific missing fields when neither source is complete", () => {
    const resolved = resolveInventoryDestinationAddress(
      { city: "Delhi", country_code: "in" },
      { city: "Delhi" }, // location has no street/pincode/phone either
      "Delhi Warehouse"
    )
    expect(missingDestinationAddressFields(resolved)).toEqual([
      "street address",
      "pincode",
      "phone",
    ])
  })
})
