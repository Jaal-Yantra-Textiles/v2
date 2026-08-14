import BlueDartFulfillmentService from "../service"
import { BLUEDART_CARRIER_ID } from "../constants"

/**
 * The registration contract, not the carrier logic.
 *
 * `BlueDartProviderAdapter` is already covered by bluedart-adapter.unit.spec;
 * what was missing until #1285 is everything Medusa needs to SEE the provider at
 * all — a stable identifier, a fulfillment-option list, and a createFulfillment
 * that maps Medusa's DTOs onto `CreateShipmentInput`. That mapping is the part
 * with no other test, because it is the part the fulfillment module drives.
 *
 * A live Blue Dart create mints a real, billable waybill, so the adapter is
 * stubbed here rather than the transport.
 */

const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const CONFIG: any = {
  client_id: "cid",
  client_secret: "csec",
  login_id: "login",
  licence_key: "lic",
  customer_code: "cust",
  fetchImpl: jest.fn(),
}

const buildService = (createShipment: jest.Mock) => {
  const svc = new BlueDartFulfillmentService({ logger }, CONFIG)
  ;(svc as any).adapter = {
    createShipment,
    checkServiceability: jest.fn().mockResolvedValue(true),
    cancelShipment: jest.fn().mockResolvedValue({ success: true }),
  }
  return svc
}

const ORDER: any = {
  id: "order_01KYPCSTQ783ZT1FKM72VHQABS",
  payment_status: "captured",
  email: "buyer@example.com",
  shipping_address: {
    first_name: "Test",
    last_name: "Buyer",
    address_1: "12 MG Road",
    city: "Gandhinagar",
    province: "Gujarat",
    postal_code: "382421",
    country_code: "IN",
    phone: "9999999999",
  },
  items: [
    {
      id: "item_1",
      title: "Handloom Dupatta",
      unit_price: 2500,
      variant_sku: "DUP-001",
      variant: { weight: 325, length: 10, width: 10, height: 3 },
    },
  ],
}

const ITEMS: any = [{ line_item_id: "item_1", title: "Handloom Dupatta", quantity: 2 }]

describe("BlueDartFulfillmentService", () => {
  it("registers under the carrier id the rest of the platform already uses", () => {
    // fulfillment.data.carrier, SUPPORTED_CARRIERS and the provider id must all
    // be the same string, or a fulfillment created here cannot be resolved back.
    expect(BlueDartFulfillmentService.identifier).toBe(BLUEDART_CARRIER_ID)
    expect(BlueDartFulfillmentService.identifier).toBe("bluedart")
  })

  it("offers a domestic option and a return, and no international one", async () => {
    const opts = await buildService(jest.fn()).getFulfillmentOptions()
    expect(opts.map((o) => o.id)).toEqual([
      "bluedart-domestic-priority",
      "bluedart-domestic-priority-return",
    ])
    expect(opts.filter((o) => o.is_return)).toHaveLength(1)
    // International (product H) stays out until #1223's HS codes land.
    // `String(...)` because FulfillmentOption types every field but `id` as
    // `unknown` — the prod-config build (which mirrors the ECS Dockerfile) is
    // stricter than `tsc --noEmit` here and rejects the bare value.
    expect(opts.some((o) => /international|ipc/i.test(String(o.name)))).toBe(false)
  })

  it("declines to calculate rather than quoting zero", async () => {
    // Blue Dart has no rate API wired. Answering `true` here and then returning
    // 0 — the other carriers' error-path behaviour — would price shipping at
    // zero on a live cart, which is worse than refusing.
    const svc = buildService(jest.fn())
    await expect(svc.canCalculate({} as any)).resolves.toBe(false)
    await expect(svc.calculatePrice({}, {}, {})).rejects.toThrow(/flat-rate/i)
  })

  it("maps order line-item variants onto the shipment, multiplying by quantity", async () => {
    const createShipment = jest.fn().mockResolvedValue({
      awb: "21091376574",
      tracking_number: "21091376574",
      tracking_url: "https://bluedart.com/track/21091376574",
      provider_refs: { waybill: "21091376574" },
    })
    const svc = buildService(createShipment)

    const result = await svc.createFulfillment(
      { from_location: { name: "Dharamshala Studio" } },
      ITEMS,
      ORDER,
      { id: "ful_1" } as any
    )

    const input = createShipment.mock.calls[0][0]
    // 325 g x 2 — the weight has to come off the ORDER item's variant, since the
    // FulfillmentItemDTO carries none.
    expect(input.weight_grams).toBe(650)
    expect(input.dimensions_cm).toEqual({ length: 10, width: 10, height: 6 })
    expect(input.payment_mode).toBe("prepaid")
    expect(input.cod_amount).toBeUndefined()
    expect(input.sub_total).toBe(5000)
    expect(input.to.pincode).toBe("382421")
    expect(input.items[0]).toMatchObject({ sku: "DUP-001", quantity: 2 })

    expect(result.data).toMatchObject({
      carrier: "bluedart",
      waybill: "21091376574",
    })
    expect(result.labels).toHaveLength(1)
  })

  it("falls back to an estimated weight and NO dimensions when variants carry neither", async () => {
    const createShipment = jest.fn().mockResolvedValue({ awb: "1" })
    const svc = buildService(createShipment)
    const bare = { ...ORDER, items: [{ id: "item_1", title: "X", unit_price: 100 }] }

    await svc.createFulfillment({}, ITEMS, bare, { id: "ful_1" } as any)

    const input = createShipment.mock.calls[0][0]
    expect(input.weight_grams).toBe(800)
    // Left undefined on purpose so the adapter applies BLUEDART_DEFAULT_DIMENSIONS
    // — Blue Dart REJECTS a waybill with no Dimensions, and inventing a size here
    // would silently override the one place that default is documented.
    expect(input.dimensions_cm).toBeUndefined()
  })

  it("treats an uncaptured order as COD", async () => {
    const createShipment = jest.fn().mockResolvedValue({ awb: "1" })
    const svc = buildService(createShipment)

    await svc.createFulfillment(
      {},
      ITEMS,
      { ...ORDER, payment_status: "awaiting" },
      { id: "ful_1" } as any
    )

    const input = createShipment.mock.calls[0][0]
    expect(input.payment_mode).toBe("cod")
    expect(input.cod_amount).toBe(5000)
  })

  it("cancels by waybill, and no-ops when there is none to cancel", async () => {
    const svc = buildService(jest.fn())
    const adapter = (svc as any).adapter

    await svc.cancelFulfillment({ data: { waybill: "21091376574" } })
    expect(adapter.cancelShipment).toHaveBeenCalledWith(
      expect.objectContaining({ awb: "21091376574" })
    )

    adapter.cancelShipment.mockClear()
    await svc.cancelFulfillment({ data: {} })
    expect(adapter.cancelShipment).not.toHaveBeenCalled()
  })
})
