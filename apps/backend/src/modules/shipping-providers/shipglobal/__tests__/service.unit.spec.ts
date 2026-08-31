import ShipglobalFulfillmentService from "../service"
import { DEFAULT_FLAT_FALLBACK } from "../../shiprocket/flat-fallback"

const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const buildService = (options: any = {}, clientOverrides: any = {}) => {
  const svc = new ShipglobalFulfillmentService(
    { logger },
    { username: "u@example.com", password: "pw", ...options }
  )
  ;(svc as any).client = {
    getRates: jest.fn(),
    createShipment: jest.fn(),
    cancelShipment: jest.fn(),
    getLabel: jest.fn(),
    ...clientOverrides,
  }
  return svc
}

const CONTEXT: any = {
  shipping_address: { country_code: "US", postal_code: "95134" },
  items: [{ variant: { weight: 600 }, quantity: 2 }],
  currency_code: "usd",
}

describe("ShipglobalFulfillmentService", () => {
  it("registers under the shipglobal identifier", () => {
    expect(ShipglobalFulfillmentService.identifier).toBe("shipglobal")
  })

  it("offers only the international fulfillment option", async () => {
    const opts = await buildService().getFulfillmentOptions()
    expect(opts.map((o) => o.id)).toEqual(["shipglobal-international"])
  })

  it("prices the recommended rate from getRates", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockResolvedValue([
        { courier_name: "ShipGlobal", amount: 1250.5, currency_code: "usd" },
      ]),
    })
    const result = await svc.calculatePrice({}, {}, CONTEXT)
    expect(result).toEqual({
      calculated_amount: 1250.5,
      is_calculated_price_tax_inclusive: true,
    })
  })

  it("falls back to the flat rate when getRates returns no courier", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockResolvedValue([]),
    })
    const result = await svc.calculatePrice({}, {}, CONTEXT)
    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
    expect(result.is_calculated_price_tax_inclusive).toBe(false)
  })

  it("falls back to the flat rate on a carrier error", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockRejectedValue(new Error("boom")),
    })
    const result = await svc.calculatePrice({}, {}, CONTEXT)
    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
  })

  it("writes the waybill and tracking number onto fulfillment data", async () => {
    const svc = buildService(undefined, {
      createShipment: jest.fn().mockResolvedValue({
        carrier: "shipglobal",
        awb: "SG123",
        tracking_number: "SG123",
        tracking_url: "https://app.shipglobal.in/tracking/SG123",
        provider_refs: { tracking: "SG123" },
      }),
    })
    const result = await svc.createFulfillment(
      {},
      [{ title: "mugs", quantity: 1, line_item_id: "li1" }],
      {
        id: "ord_1",
        shipping_address: {
          first_name: "John",
          last_name: "Smith",
          phone: "+1-999-999-9999",
          address_1: "4 building name",
          city: "SAN JOSE",
          province: "CA",
          postal_code: "95134",
          country_code: "US",
        },
        items: [{ id: "li1", title: "mugs", unit_price: 54, variant: {} }],
        currency_code: "USD",
      } as any,
      { id: "ful_1" } as any
    )
    expect(result.data.carrier).toBe("shipglobal")
    expect(result.data.waybill).toBe("SG123")
    expect(result.data.tracking_number).toBe("SG123")
    expect(result.labels).toHaveLength(1)
  })

  it("cancels a fulfillment by its waybill", async () => {
    const cancel = jest.fn().mockResolvedValue({ success: true })
    const svc = buildService(undefined, { cancelShipment: cancel })
    await svc.cancelFulfillment({ data: { waybill: "SG123" } } as any)
    expect(cancel).toHaveBeenCalledWith({
      awb: "SG123",
      provider_refs: { tracking: "SG123" },
    })
  })
})