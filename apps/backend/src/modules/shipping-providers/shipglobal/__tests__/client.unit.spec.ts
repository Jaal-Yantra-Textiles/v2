import {
  ShipglobalClient,
  buildOrderBody,
  extractTracking,
  scanTypeForEventCode,
  normalizeShipglobalTracking,
  normalizeShipglobalRates,
  parseTransitDays,
} from "../client"
import { CreateShipmentInput } from "../../provider-interface"

const clientWith = (status: number, body: any) => {
  const calls: Array<{ url: string; init?: any }> = []
  const fetchImpl = (async (url: string, init?: any) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    }
  }) as any
  return {
    client: new ShipglobalClient({
      username: "user@example.com",
      password: "pw",
      fetchImpl,
    }),
    calls,
  }
}

const INPUT: CreateShipmentInput = {
  reference_id: "ord_123",
  payment_mode: "prepaid",
  pickup_location_name: "",
  to: {
    name: "John Smith",
    phone: "+1-999-999-9999",
    email: "demo@example.com",
    address_1: "4 building name",
    address_2: "5th Street",
    city: "SAN JOSE",
    state: "CA",
    pincode: "95134",
    country: "US",
  },
  items: [
    {
      name: "mugs",
      sku: "",
      quantity: 1,
      unit_price: 54,
      hsn: "6111.20.00",
      tax: 0,
    },
  ],
  weight_grams: 500,
  dimensions_cm: { length: 10, width: 10, height: 10 },
  currency: "USD",
}

describe("buildOrderBody", () => {
  it("maps a shipment input onto the ShipGlobal order/add contract", () => {
    const body = buildOrderBody(INPUT, "sgdirectyungb")
    expect(body.invoice_no).toBe("ord_123")
    expect(body.order_reference).toBe("ord_123")
    expect(body.service).toBe("sgdirectyungb")
    // Weight in KG, dims in CM, both as strings.
    expect(body.package_weight).toBe("0.5")
    expect(body.package_length).toBe("10")
    expect(body.customer_shipping_firstname).toBe("John")
    expect(body.customer_shipping_lastname).toBe("Smith")
    expect(body.customer_shipping_country_code).toBe("US")
    expect(body.customer_shipping_postcode).toBe("95134")
    expect(body.currency_code).toBe("USD")
    expect(body.csb5_status).toBe(1)
  })

  it("normalizes an HSN to digits and sets a string invoice_date", () => {
    const body = buildOrderBody(INPUT, "sgdirectyungb")
    expect(body.invoice_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.vendor_order_items[0].vendor_order_item_hsn).toBe("61112000")
    expect(body.vendor_order_items[0].vendor_order_item_quantity).toBe("1")
    expect(body.vendor_order_items[0].vendor_order_item_unit_price).toBe("54")
  })
})

describe("extractTracking", () => {
  it("reads the tracking number from every plausible response key", () => {
    expect(extractTracking({ data: { tracking: "SG123" } })).toBe("SG123")
    expect(extractTracking({ tracking_number: "SG456" })).toBe("SG456")
    expect(extractTracking({ data: { awb: "SG789" } })).toBe("SG789")
    expect(extractTracking({})).toBe("")
  })
})

describe("scanTypeForEventCode", () => {
  it("classifies SGE event codes into coarse scan types", () => {
    expect(scanTypeForEventCode("SGE_001")).toBe("created")
    expect(scanTypeForEventCode("SGE_304")).toBe("delivered")
    expect(scanTypeForEventCode("SGE_402")).toBe("rto")
    expect(scanTypeForEventCode("SGE_503")).toBe("rto")
    expect(scanTypeForEventCode("SGERROR_103")).toBe("exception")
    expect(scanTypeForEventCode("SGE_301")).toBe("in_transit")
  })
})

describe("normalizeShipglobalTracking", () => {
  it("maps the live awb_-prefixed snake_case fields onto a TrackingResult", () => {
    const result = normalizeShipglobalTracking(
      {
        success: true,
        data: {
          awbInfo: {
            awb_status: "DELIVERED ",
            awb_sender_name: "linkers",
            awb_destination: "US",
            awb_number: "SG3231027366055",
          },
          awbEvents: [
            {
              awb_history_datetime: "2023-10-03 10:46:11",
              awb_history_location: "San Jose, CA, US",
              awb_history_comment: "DELIVERED ",
              type: "lastmile",
              awb_event_code: "SGE_304",
            },
            {
              awb_history_datetime: "2023-09-29 13:31:29",
              awb_history_location: "Delhi",
              awb_history_comment: "Shipment Information Received.",
              type: "connector",
              awb_event_code: "SGE_001",
            },
          ],
        },
      },
      "SG123"
    )
    expect(result.carrier).toBe("shipglobal")
    expect(result.awb).toBe("SG123")
    expect(result.current_status).toBe("DELIVERED ")
    expect(result.origin).toBe("linkers")
    expect(result.destination).toBe("US")
    expect(result.events).toHaveLength(2)
    expect(result.events[0].scan_type).toBe("delivered")
    expect(result.events[0].location).toBe("San Jose, CA, US")
    expect(result.events[1].scan_type).toBe("created")
  })
})

describe("parseTransitDays", () => {
  it("parses the high end of a transit-time range", () => {
    expect(parseTransitDays("7-10 Days")).toBe(10)
    expect(parseTransitDays("4 - 7 Days")).toBe(7)
    expect(parseTransitDays("6-9 Days")).toBe(9)
    expect(parseTransitDays(undefined)).toBeUndefined()
  })
})

describe("normalizeShipglobalRates", () => {
  it("maps the services array into rate options with the top-level currency", () => {
    const rates = normalizeShipglobalRates({
      success: true,
      billed_weight: 20,
      currency: "INR",
      services: [
        {
          title: "ShipGlobal Direct",
          notes: "",
          transit_time: "7-10 Days",
          price: { logistic_fee: 285 },
          subtotal_fee: 300,
        },
        {
          title: "ShipGlobal First Class",
          notes: "",
          transit_time: "7-10 Days",
          price: { logistic_fee: 311 },
          subtotal_fee: 326,
        },
      ],
    })
    expect(rates).toHaveLength(2)
    expect(rates[0]).toMatchObject({
      courier_name: "ShipGlobal Direct",
      amount: 300,
      currency_code: "inr",
      estimated_days: 10,
      is_recommended: true,
    })
    expect(rates[1].courier_name).toBe("ShipGlobal First Class")
    expect(rates[1].is_recommended).toBe(false)
  })

  it("falls back to logistic_fee when subtotal_fee is absent", () => {
    const rates = normalizeShipglobalRates({
      currency: "INR",
      services: [{ title: "UPS", price: { logistic_fee: 2009 } }],
    })
    expect(rates[0].amount).toBe(2009)
  })

  it("returns [] when there are no serviceable rows", () => {
    expect(normalizeShipglobalRates({ currency: "INR", services: [] })).toEqual([])
    expect(normalizeShipglobalRates({ success: true })).toEqual([])
  })
})

describe("ShipglobalClient", () => {
  it("refuses a domestic rate query", async () => {
    const { client, calls } = clientWith(200, { data: { rate: 10 } })
    const rates = await client.getRates({
      origin_pincode: "411014",
      destination_pincode: "411014",
      destination_country: "IN",
      weight_grams: 500,
    })
    expect(rates).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("posts the rate body with weight in kg for an international lane", async () => {
    const { client, calls } = clientWith(200, {
      success: true,
      currency: "INR",
      services: [
        {
          title: "ShipGlobal Direct",
          transit_time: "7-10 Days",
          price: { logistic_fee: 285 },
          subtotal_fee: 300,
        },
      ],
    })
    const rates = await client.getRates({
      origin_pincode: "411014",
      destination_pincode: "AB32",
      destination_country: "GB",
      weight_grams: 1500,
    })
    expect(calls[0].url).toContain("/rates/calculate")
    expect(JSON.parse(calls[0].init.body)).toEqual({
      package_weight: "1.5",
      country_iso_code_2: "GB",
      postcode: "AB32",
    })
    expect(rates).toHaveLength(1)
    expect(rates[0].amount).toBe(300)
    expect(rates[0].currency_code).toBe("inr")
  })

  it("creates a shipment via order/add and returns the tracking number", async () => {
    const { client, calls } = clientWith(200, {
      success: true,
      data: { tracking: "SG32607086295274" },
    })
    const result = await client.createShipment(INPUT)
    expect(calls[0].url).toContain("/order/add")
    expect(result.awb).toBe("SG32607086295274")
    expect(result.tracking_number).toBe("SG32607086295274")
    expect(result.tracking_url).toContain("SG32607086295274")
    expect(result.provider_refs?.tracking).toBe("SG32607086295274")
  })

  it("throws when order/add returns no tracking number", async () => {
    const { client } = clientWith(200, { success: true })
    await expect(client.createShipment(INPUT)).rejects.toThrow(/no tracking number/)
  })

  it("tracks via tools/tracking and normalizes the events", async () => {
    const { client, calls } = clientWith(200, {
      data: {
        awbInfo: { awb_status: "DELIVERED " },
        awbEvents: [],
      },
    })
    const result = await client.track({ awb: "SG123" })
    expect(calls[0].url).toContain("/tools/tracking")
    expect(JSON.parse(calls[0].init.body)).toEqual({ tracking: "SG123" })
    expect(result.current_status).toBe("DELIVERED ")
  })

  it("fetches a base64 PDF label via order/getLabel", async () => {
    const { client, calls } = clientWith(200, {
      success: true,
      tracking: "SG3231107366132",
      label: "JVBERi0xLjQKMSAwIG9iago=",
    })
    const label = await client.getLabel({
      awb: "SG3231107366132",
      provider_refs: { tracking: "SG3231107366132" },
    })
    expect(calls[0].url).toContain("/order/getLabel")
    expect(JSON.parse(calls[0].init.body)).toEqual({
      tracking: "SG3231107366132",
      label: true,
    })
    expect(label.data).toBe("JVBERi0xLjQKMSAwIG9iago=")
    expect(label.format).toBe("pdf")
  })

  it("cancels via cancelRefundOrder", async () => {
    const { client, calls } = clientWith(200, { success: true })
    const result = await client.cancelShipment({ awb: "SG123" })
    expect(calls[0].url).toContain("/order/cancelRefundOrder")
    expect(JSON.parse(calls[0].init.body)).toEqual({ tracking: "SG123" })
    expect(result.success).toBe(true)
  })
})