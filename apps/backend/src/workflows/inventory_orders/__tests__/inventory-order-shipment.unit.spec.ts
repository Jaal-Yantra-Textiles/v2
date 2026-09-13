import {
  buildInventoryOrderShipmentInput,
  DEFAULT_INVENTORY_SHIPMENT_WEIGHT_GRAMS,
  DEFAULT_SAMPLE_DECLARED_VALUE,
  missingDestinationAddressFields,
  normalizeDimensionsCm,
  resolveInventoryDestinationAddress,
  SAMPLE_SHIPMENT_ITEM_NAME,
  SAMPLE_SHIPMENT_ITEM_SKU,
  type InventoryOrderForShipment,
} from "../lib/inventory-order-shipment"
import { readEnvDeclaredValue } from "../create-inventory-order-shipment"

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
    // A sample order, because a bare NON-sample order now throws (#2009) and
    // this case is about the pickup/name/country fallbacks, not the manifest.
    const input = buildInventoryOrderShipmentInput({
      id: "x",
      orderlines: [],
      is_sample: true,
    })
    expect(input.pickup_location_name).toBe("")
    expect(input.to.name).toBe("Warehouse")
    expect(input.to.country).toBe("IN")
  })
})

describe("buildInventoryOrderShipmentInput empty manifests (#2009)", () => {
  const sampleOrder: InventoryOrderForShipment = {
    id: "inv_sample_1",
    is_sample: true,
    total_price: 0,
    metadata: {},
    orderlines: [],
  }

  it("synthesises one contents line for a sample order with no lines", () => {
    const input = buildInventoryOrderShipmentInput(sampleOrder, { pickupLocationName: "wh" })
    expect(input.items).toEqual([
      {
        name: SAMPLE_SHIPMENT_ITEM_NAME,
        sku: SAMPLE_SHIPMENT_ITEM_SKU,
        quantity: 1,
        unit_price: DEFAULT_SAMPLE_DECLARED_VALUE,
      },
    ])
  })

  it("declares the nominal value, never the sample order's own 0", () => {
    const input = buildInventoryOrderShipmentInput(sampleOrder, {})
    expect(input.sub_total).toBe(DEFAULT_SAMPLE_DECLARED_VALUE)
    expect(input.sub_total).toBeGreaterThan(0)
  })

  it("ranks explicit call value > order metadata > deployment default > nominal", () => {
    const withMeta = { ...sampleOrder, metadata: { declared_value: 420 } }
    // Every rung present: the explicit call value wins.
    expect(
      buildInventoryOrderShipmentInput(withMeta, {
        sampleDeclaredValue: 750,
        defaultSampleDeclaredValue: 300,
      }).sub_total
    ).toBe(750)
    // No call value: the ORDER's own figure beats the deployment default —
    // whoever typed it knows what is in this parcel.
    expect(
      buildInventoryOrderShipmentInput(withMeta, { defaultSampleDeclaredValue: 300 })
        .sub_total
    ).toBe(420)
    // Neither: the deployment default (SSM) applies.
    expect(
      buildInventoryOrderShipmentInput(sampleOrder, { defaultSampleDeclaredValue: 300 })
        .sub_total
    ).toBe(300)
    // Nothing at all: the compiled-in nominal.
    expect(buildInventoryOrderShipmentInput(sampleOrder, {}).sub_total).toBe(
      DEFAULT_SAMPLE_DECLARED_VALUE
    )
  })

  it("ignores non-positive / unparseable values at every rung", () => {
    expect(
      buildInventoryOrderShipmentInput(
        { ...sampleOrder, metadata: { declared_value: 0 } },
        { defaultSampleDeclaredValue: 0, sampleDeclaredValue: -5 }
      ).sub_total
    ).toBe(DEFAULT_SAMPLE_DECLARED_VALUE)
  })

  it("the compiled-in nominal matches the seeded SSM figure (500)", () => {
    // These two are deliberately the same number: an unset parameter must not
    // silently change what a customs officer reads off the label.
    expect(DEFAULT_SAMPLE_DECLARED_VALUE).toBe(500)
  })

  it("honours metadata.is_sample when the column is absent (unified-order mirror)", () => {
    const input = buildInventoryOrderShipmentInput(
      { id: "inv_2", metadata: { is_sample: true }, orderlines: [] },
      {}
    )
    expect(input.items).toHaveLength(1)
  })

  it("prices a COD sample parcel at the declared value, not 0", () => {
    const input = buildInventoryOrderShipmentInput(
      { ...sampleOrder, metadata: { payment_mode: "cod" } },
      {}
    )
    expect(input.cod_amount).toBe(DEFAULT_SAMPLE_DECLARED_VALUE)
  })

  it("leaves a sample order that HAS lines completely alone", () => {
    const input = buildInventoryOrderShipmentInput(
      {
        ...sampleOrder,
        total_price: 300,
        orderlines: [{ id: "l1", quantity: 2, price: 150, metadata: { title: "Swatch", sku: "SW-1" } }],
      },
      {}
    )
    expect(input.items).toEqual([{ name: "Swatch", sku: "SW-1", quantity: 2, unit_price: 150 }])
    expect(input.sub_total).toBe(300)
  })

  it("THROWS on a non-sample order with no lines rather than booking an empty manifest", () => {
    expect(() =>
      buildInventoryOrderShipmentInput({ id: "inv_3", orderlines: [] }, {})
    ).toThrow(/nothing to ship/i)
  })

  it("THROWS when every delivered quantity is zero (same empty manifest, other door)", () => {
    expect(() =>
      buildInventoryOrderShipmentInput(baseOrder, {
        deliveredQuantities: { ol_1: 0, ol_2: 0 },
      })
    ).toThrow(/nothing to ship/i)
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

describe("readEnvDeclaredValue (SSM → workflow, #2009)", () => {
  it("reads a positive numeric value", () => {
    expect(readEnvDeclaredValue({ SAMPLE_SHIPMENT_DECLARED_VALUE: "500" })).toBe(500)
  })

  it("returns undefined for unset, blank, non-numeric or non-positive values", () => {
    for (const raw of [undefined, "", "   ", "abc", "0", "-100"]) {
      expect(
        readEnvDeclaredValue({ SAMPLE_SHIPMENT_DECLARED_VALUE: raw } as any)
      ).toBeUndefined()
    }
  })
})
