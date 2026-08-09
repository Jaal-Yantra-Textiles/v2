import DelhiveryFulfillmentService from "../service"
import {
  createDelhiveryStubFetch,
  delhiveryStubState,
  resetDelhiveryStub,
} from "../stub-fetch"
import { delhiveryWarehouseNameForLocation } from "../warehouse-name"

/**
 * The order-#83 path, driven end to end against the stub transport.
 *
 * This is the closest we can get to a live test: Delhivery has no usable
 * sandbox, so a real `create` mints a billable waybill. The stub enforces the
 * genuine invariant — it refuses any manifest whose pickup name was not
 * registered first — so passing here means the registration/naming contract
 * actually holds, not that a canned string was matched.
 */

const LOCATION_ID = "sloc_01JPAQVGYJR3CDP2Q2AYV7GRDR"
const EXPECTED_PICKUP = delhiveryWarehouseNameForLocation(LOCATION_ID)!

const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const buildService = () =>
  new DelhiveryFulfillmentService(
    { logger },
    { api_token: "test-token", fetchImpl: createDelhiveryStubFetch() } as any
  )

const ORDER: any = {
  id: "order_01KYPCSTQ783ZT1FKM72VHQABS",
  payment_status: "captured",
  shipping_address: {
    first_name: "Test",
    last_name: "Buyer",
    address_1: "12 MG Road",
    city: "Gandhinagar",
    province: "Gujarat",
    postal_code: "382421",
    country_code: "IN",
    phone: "9876500000",
  },
  items: [{ id: "li_1", variant: { weight: 500, length: 30, width: 25, height: 4 } }],
}

const ITEMS: any = [{ line_item_id: "li_1", quantity: 1, title: "Embroidered jacket" }]

/** What core passes as the 4th arg: the created fulfillment, minus data/items. */
const FULFILLMENT: any = { id: "ful_test", location_id: LOCATION_ID }

describe("Delhivery createFulfillment", () => {
  beforeEach(() => {
    resetDelhiveryStub()
    jest.clearAllMocks()
  })

  it("refuses to record a shipment when the location has no registered warehouse", async () => {
    const service = buildService()

    // This is exactly what happened in prod: the warehouse was never registered,
    // Delhivery answered 200 + success:false, and the old code returned an empty
    // waybill that Medusa stored as a normal fulfillment.
    await expect(
      service.createFulfillment({}, ITEMS, ORDER, FULFILLMENT)
    ).rejects.toThrow(/no registered pickup warehouse/i)
  })

  it("derives the pickup name from fulfillment.location_id, never 'Default'", async () => {
    const service = buildService()
    await service.createFulfillment({}, ITEMS, ORDER, FULFILLMENT).catch(() => {})

    const sent = delhiveryStubState.lastManifestBody
    expect(sent.pickup_location.name).toBe(EXPECTED_PICKUP)
    // The old code resolved `data.from_location` — always {} — to this literal.
    expect(sent.pickup_location.name).not.toBe("Default")
  })

  it("manifests successfully once the warehouse is registered", async () => {
    delhiveryStubState.registeredWarehouses.add(EXPECTED_PICKUP)
    const service = buildService()

    const result = await service.createFulfillment({}, ITEMS, ORDER, FULFILLMENT)

    expect(result.data.waybill).toBe("STUBWBN123")
    expect(result.data.tracking_number).toBe("STUBWBN123")
    expect(result.data.pickup_location_name).toBe(EXPECTED_PICKUP)
    expect(result.labels).toHaveLength(1)
    expect(result.labels![0].tracking_number).toBe("STUBWBN123")
  })

  it("prefers an explicitly recorded warehouse name over the derived one", async () => {
    // A location already registered with Delhivery under a hand-chosen name is
    // supported by recording it in metadata; that must win.
    const recorded = "JYT-Dharamshala-Main"
    delhiveryStubState.registeredWarehouses.add(recorded)
    const service = buildService()

    const result = await service.createFulfillment(
      { from_location: { metadata: { delhivery_warehouse_name: recorded } } },
      ITEMS,
      ORDER,
      FULFILLMENT
    )

    expect(result.data.pickup_location_name).toBe(recorded)
  })

  it("sends the real parcel weight rather than a bracket guess when the variant has one", async () => {
    delhiveryStubState.registeredWarehouses.add(EXPECTED_PICKUP)
    const service = buildService()

    await service.createFulfillment({}, ITEMS, ORDER, FULFILLMENT)

    expect(delhiveryStubState.lastManifestBody.shipments[0].weight).toBe(500)
  })
})
