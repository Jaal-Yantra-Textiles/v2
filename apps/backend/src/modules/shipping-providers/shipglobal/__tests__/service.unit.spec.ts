import ShipglobalFulfillmentService from "../service"
import { DEFAULT_FLAT_FALLBACK } from "../../shiprocket/flat-fallback"

const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const buildService = (
  options: any = {},
  clientOverrides: any = {},
  fx_rates?: any
) => {
  const svc = new ShipglobalFulfillmentService(
    { logger, fx_rates },
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

  /**
   * 🔴 The reason this file exists in its current form.
   *
   * ShipGlobal quotes RUPEES — its dashboard rate calculator answers a Sweden
   * lane in INR only. The success path used to return `recommended.amount`
   * raw, so a live EUR checkout billed ₹ as €. Prod showed €200.00 beside a
   * converted Shiprocket quote of €19.81 for the same parcel.
   */
  const EUR_CONTEXT: any = {
    shipping_address: { country_code: "SE", postal_code: "11120" },
    items: [{ variant: { weight: 600 }, quantity: 2 }],
    currency_code: "eur",
  }

  it("converts a rupee quote into the cart's currency", async () => {
    const getRate = jest.fn().mockResolvedValue(0.011)
    const svc = buildService(
      undefined,
      {
        getRates: jest.fn().mockResolvedValue([
          { courier_name: "ShipGlobal Direct", amount: 3200, currency_code: "inr" },
        ]),
      },
      { getRate }
    )

    const result = await svc.calculatePrice({}, {}, EUR_CONTEXT)

    expect(getRate).toHaveBeenCalledWith("INR", "EUR")
    // 3200 * 0.011 = 35.2, NOT the raw 3200.
    expect(result).toEqual({
      calculated_amount: 35.2,
      is_calculated_price_tax_inclusive: true,
    })
  })

  it("falls back rather than quoting rupees as euros when there is no fx module", async () => {
    const svc = buildService(undefined, {
      getRates: jest.fn().mockResolvedValue([
        { courier_name: "ShipGlobal Direct", amount: 3200, currency_code: "inr" },
      ]),
    })

    const result = await svc.calculatePrice({}, {}, EUR_CONTEXT)

    expect(result.calculated_amount).not.toBe(3200)
    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
    expect(result.is_calculated_price_tax_inclusive).toBe(false)
  })

  it("falls back rather than guessing when the quote states no currency", async () => {
    const getRate = jest.fn()
    const svc = buildService(
      undefined,
      {
        getRates: jest.fn().mockResolvedValue([
          { courier_name: "ShipGlobal Direct", amount: 3200 },
        ]),
      },
      { getRate }
    )

    const result = await svc.calculatePrice({}, {}, EUR_CONTEXT)

    expect(getRate).not.toHaveBeenCalled()
    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
  })

  it("falls back when the fx module has no rate for the pair", async () => {
    const svc = buildService(
      undefined,
      {
        getRates: jest.fn().mockResolvedValue([
          { courier_name: "ShipGlobal Direct", amount: 3200, currency_code: "inr" },
        ]),
      },
      { getRate: jest.fn().mockRejectedValue(new Error("no inr->eur rate")) }
    )

    const result = await svc.calculatePrice({}, {}, EUR_CONTEXT)

    expect(result.calculated_amount).toBe(DEFAULT_FLAT_FALLBACK)
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