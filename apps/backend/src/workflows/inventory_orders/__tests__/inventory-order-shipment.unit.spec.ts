import {
  buildInventoryOrderShipmentInput,
  DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS,
  missingDestinationAddressFields,
  normalizeDimensionsCm,
  resolveInventoryDestinationAddress,
  type InventoryOrderForShipment,
} from "../lib/inventory-order-shipment"

describe("normalizeDimensionsCm (breadth → width for the courier)", () => {
  it("maps breadth to the canonical width the client reads", () => {
    expect(normalizeDimensionsCm({ length: 30, breadth: 20, height: 10 })).toEqual(
      { length: 30, width: 20, height: 10 }
    )
  })

  it("passes an explicit width through and prefers it over breadth", () => {
    expect(
      normalizeDimensionsCm({ length: 30, width: 25, breadth: 20, height: 10 } as any)
    ).toEqual({ length: 30, width: 25, height: 10 })
  })

  it("keeps only provided fields (partial dims)", () => {
    expect(normalizeDimensionsCm({ breadth: 15 })).toEqual({ width: 15 })
  })

  it("returns undefined for empty/absent input", () => {
    expect(normalizeDimensionsCm(undefined)).toBeUndefined()
    expect(normalizeDimensionsCm(null)).toBeUndefined()
    expect(normalizeDimensionsCm({})).toBeUndefined()
  })
})

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

describe("buildInventoryOrderShipmentInput colour-variant identity (#817 / SKU-repeat fix)", () => {
  // Mirrors the real order #68: 16 colour variants, no line/metadata SKU, but a
  // real inventory_item SKU + material_name + colour on each line.
  const colourOrder: InventoryOrderForShipment = {
    id: "inv_1",
    orderlines: [
      { id: "l1", quantity: 2, price: 100, sku: "OTH-TAN-BLA-001", color: "Black", material_name: "Tangaliya Weave — Black" },
      { id: "l2", quantity: 3, price: 100, sku: "OTH-TAN-MID-001", color: "midnight blue", material_name: "Tangaliya Weave — midnight blue" },
      // A no-SKU line whose base name does NOT embed the colour — colour is appended.
      { id: "l3", quantity: 1, price: 100, color: "Soft pale yellow", material_name: "Tangaliya Weave" },
    ],
  }

  it("gives each colour variant a distinct sku + name (no repeats)", () => {
    const input = buildInventoryOrderShipmentInput(colourOrder, {})
    expect(input.items).toHaveLength(3)
    expect(input.items.map((i) => i.sku)).toEqual([
      "OTH-TAN-BLA-001",
      "OTH-TAN-MID-001",
      undefined, // falls back to the (distinct) name
    ])
    // base already embeds the colour → not appended twice
    expect(input.items[0].name).toBe("Tangaliya Weave — Black")
    expect(input.items[1].name).toBe("Tangaliya Weave — midnight blue")
    // base has no colour → colour appended for distinctness
    expect(input.items[2].name).toBe("Tangaliya Weave — Soft pale yellow")
    // The effective carrier key (sku || name) is unique across all lines.
    const effective = input.items.map((i) => i.sku || i.name)
    expect(new Set(effective).size).toBe(input.items.length)
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
