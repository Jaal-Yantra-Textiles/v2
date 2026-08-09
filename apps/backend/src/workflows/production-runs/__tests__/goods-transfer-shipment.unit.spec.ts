import {
  buildTransferShipmentInput,
  describeRunOutput,
  transferQuantity,
  transferUnitValue,
  DEFAULT_TRANSFER_WEIGHT_GRAMS,
} from "../lib/goods-transfer-shipment"

/**
 * #891 — the pure half of a production-run goods transfer: turning a run into a
 * carrier shipment for a location→location hop.
 */

const ADDRESS = {
  first_name: "Finishing Unit",
  address_1: "9 Loom Street",
  city: "Bhuj",
  province: "GJ",
  postal_code: "370001",
  country_code: "in",
  phone: "+919800000000",
}

describe("transferQuantity", () => {
  it("prefers what the run actually produced over what it was asked for", () => {
    // A run that made 8 of 10 moves 8 boxes, not 10.
    expect(transferQuantity({ id: "r", quantity: 10, produced_quantity: 8 })).toBe(8)
  })

  it("falls back to the ordered quantity before a produced one exists", () => {
    expect(transferQuantity({ id: "r", quantity: 10 })).toBe(10)
  })

  it("lets an explicit quantity win — a hop can move part of the output", () => {
    expect(
      transferQuantity({ id: "r", quantity: 10, produced_quantity: 8 }, 3)
    ).toBe(3)
  })

  it("never returns 0 or a negative — that would ship an empty manifest", () => {
    expect(transferQuantity({ id: "r", quantity: 0, produced_quantity: 0 })).toBe(1)
    expect(transferQuantity({ id: "r" }, -5)).toBe(1)
  })
})

describe("transferUnitValue", () => {
  it("divides a run-total cost down to a unit price", () => {
    // Declaring the whole run's value on every unit would multiply the
    // manifest's declared value by the quantity.
    expect(
      transferUnitValue(
        { id: "r", quantity: 4, partner_cost_estimate: 800, cost_type: "total" },
        4
      )
    ).toBe(200)
  })

  it("takes a per-unit cost as-is", () => {
    expect(
      transferUnitValue(
        { id: "r", quantity: 4, partner_cost_estimate: 200, cost_type: "per_unit" },
        4
      )
    ).toBe(200)
  })

  it("is 0 when the run carries no cost, rather than NaN", () => {
    expect(transferUnitValue({ id: "r", quantity: 2 }, 2)).toBe(0)
    expect(
      transferUnitValue({ id: "r", quantity: 2, partner_cost_estimate: 0 }, 2)
    ).toBe(0)
  })
})

describe("describeRunOutput", () => {
  it("reads the design title out of the run snapshot", () => {
    expect(
      describeRunOutput({ id: "r", snapshot: { design_name: "Namtso Scarf" } })
    ).toBe("Namtso Scarf")
  })

  it("falls back to a generic name — a run has no title column of its own", () => {
    expect(describeRunOutput({ id: "r", snapshot: {} })).toBe("Finished goods")
    expect(describeRunOutput({ id: "r" })).toBe("Finished goods")
  })
})

describe("buildTransferShipmentInput", () => {
  const run = {
    id: "prod_run_1",
    design_id: "design_9",
    quantity: 4,
    produced_quantity: 4,
    partner_cost_estimate: 800,
    cost_type: "total",
    snapshot: { design_name: "Namtso Scarf" },
  }

  it("maps the run onto a single-item prepaid shipment for the destination", () => {
    const input = buildTransferShipmentInput(run, {
      pickupLocationName: "weaver-bhuj",
      destinationAddress: ADDRESS,
    })

    expect(input.payment_mode).toBe("prepaid")
    // Nobody collects cash for moving our own goods between our own locations.
    expect(input.cod_amount).toBeUndefined()
    expect(input.pickup_location_name).toBe("weaver-bhuj")
    expect(input.items).toEqual([
      {
        name: "Namtso Scarf",
        sku: "design_9",
        quantity: 4,
        unit_price: 200,
      },
    ])
    expect(input.sub_total).toBe(800)
    expect(input.to).toMatchObject({
      name: "Finishing Unit",
      city: "Bhuj",
      state: "GJ",
      pincode: "370001",
      country: "IN",
      phone: "+919800000000",
    })
    expect(input.weight_grams).toBe(DEFAULT_TRANSFER_WEIGHT_GRAMS)
  })

  /**
   * The #1225 trap, one layer up: `create/adhoc` dedupes on the channel order
   * id, so two hops of one run sharing a reference would resolve to a single
   * carrier order and the second would assign against the first one's shipment.
   */
  it("keys the carrier reference on the TRANSFER, not the run", () => {
    const first = buildTransferShipmentInput(run, {
      destinationAddress: ADDRESS,
      transferId: "gtrf_1",
    })
    const second = buildTransferShipmentInput(run, {
      destinationAddress: ADDRESS,
      transferId: "gtrf_2",
    })

    expect(first.reference_id).toBe("gtrf_1")
    expect(second.reference_id).toBe("gtrf_2")
    expect(first.reference_id).not.toBe(second.reference_id)
  })

  it("falls back to the run id when no transfer id is supplied", () => {
    expect(
      buildTransferShipmentInput(run, { destinationAddress: ADDRESS }).reference_id
    ).toBe("prod_run_1")
  })

  it("declares only the units in this hop, not the whole run", () => {
    const input = buildTransferShipmentInput(run, {
      destinationAddress: ADDRESS,
      quantity: 1,
    })
    expect(input.items[0].quantity).toBe(1)
    expect(input.sub_total).toBe(200)
  })

  it("uppercases the destination country and carries parcel details through", () => {
    const input = buildTransferShipmentInput(run, {
      destinationAddress: { ...ADDRESS, country_code: "in" },
      weightGrams: 3614,
      dimensionsCm: { length: 12, width: 11, height: 7 },
      preferredCourierId: 262,
    })
    expect(input.to.country).toBe("IN")
    expect(input.weight_grams).toBe(3614)
    expect(input.dimensions_cm).toEqual({ length: 12, width: 11, height: 7 })
    expect(input.preferred_courier_id).toBe(262)
  })

  it("names the box 'Warehouse' when the destination address has no contact", () => {
    const input = buildTransferShipmentInput(run, {
      destinationAddress: { ...ADDRESS, first_name: undefined },
    })
    expect(input.to.name).toBe("Warehouse")
  })
})
