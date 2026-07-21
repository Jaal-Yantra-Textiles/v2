import {
  ShiprocketClient,
  buildInternationalCreateBody,
  toShiprocketCountryName,
  isInternationalDestination,
  resolveCustomsDefaults,
} from "../client"
import type { CreateShipmentInput } from "../../provider-interface"

/**
 * #1111 S1 — International Shiprocket shipping. The client detects a non-India
 * destination and routes to Shiprocket's separate `/international/*` namespace
 * with a customs-declaration body. See apps/docs/notes/SHIPROCKET_INTERNATIONAL_API.md.
 */

const usInput = (over: Partial<CreateShipmentInput> = {}): CreateShipmentInput => ({
  reference_id: "order_us_1",
  payment_mode: "prepaid",
  pickup_location_name: "warehouse-abc",
  to: {
    name: "Elena Doe",
    phone: "+19762343722",
    address_1: "12 Main St",
    city: "Dallas",
    state: "Texas",
    pincode: "75201",
    country: "US",
  },
  items: [{ name: "Silk Scarf", sku: "SCARF-1", quantity: 2, unit_price: 40, hsn: "6214" }],
  weight_grams: 600,
  sub_total: 80,
  currency: "USD",
  ...over,
})

describe("isInternationalDestination", () => {
  it("is false for India / IN / empty, true for foreign", () => {
    expect(isInternationalDestination("IN")).toBe(false)
    expect(isInternationalDestination("India")).toBe(false)
    expect(isInternationalDestination("")).toBe(false)
    expect(isInternationalDestination(undefined)).toBe(false)
    expect(isInternationalDestination("US")).toBe(true)
    expect(isInternationalDestination("United States")).toBe(true)
  })
})

describe("toShiprocketCountryName", () => {
  it("maps ISO-2 to the full name Shiprocket's create body expects", () => {
    expect(toShiprocketCountryName("US")).toBe("United States")
    expect(toShiprocketCountryName("GB")).toBe("United Kingdom")
    expect(toShiprocketCountryName("AE")).toBe("United Arab Emirates")
    expect(toShiprocketCountryName("IN")).toBe("India")
  })
  it("passes a full name through and defaults empty to India", () => {
    expect(toShiprocketCountryName("Australia")).toBe("Australia")
    expect(toShiprocketCountryName("")).toBe("India")
  })
})

describe("resolveCustomsDefaults", () => {
  it("defaults to a commercial FOB export", () => {
    expect(resolveCustomsDefaults()).toEqual({
      reasonOfExport: 3,
      purpose_of_shipment: 2,
      Terms_Of_Invoice: "FOB",
      igstPaymentStatus: "A",
      commodity: true,
    })
  })
  it("honours caller overrides", () => {
    expect(
      resolveCustomsDefaults({ reason_of_export: 2, terms_of_invoice: "CIF" })
    ).toMatchObject({ reasonOfExport: 2, Terms_Of_Invoice: "CIF" })
  })
})

describe("buildInternationalCreateBody", () => {
  it("builds a customs-bearing body with country NAME + currency", () => {
    const body = buildInternationalCreateBody(usInput(), "warehouse-abc")
    expect(body).toMatchObject({
      pickup_location: "warehouse-abc",
      billing_country: "United States",
      isd_code: "+1",
      payment_method: "Prepaid",
      currency: "USD",
      reasonOfExport: 3,
      purpose_of_shipment: 2,
      Terms_Of_Invoice: "FOB",
      igstPaymentStatus: "A",
      commodity: true,
      sub_total: 80,
    })
    expect(body.order_items[0]).toMatchObject({ sku: "SCARF-1", hsn: "6214", units: 2 })
  })

  it("throws when any line is missing an HSN code (mandatory internationally)", () => {
    const input = usInput({
      items: [{ name: "Mystery Item", sku: "M-1", quantity: 1, unit_price: 10 }],
    })
    expect(() => buildInternationalCreateBody(input, "wh")).toThrow(/HSN code is required/i)
  })

  it("throws when the caller asks for COD (unavailable internationally)", () => {
    expect(() =>
      buildInternationalCreateBody(usInput({ payment_mode: "cod" }), "wh")
    ).toThrow(/COD/i)
  })

  it("defaults currency to INR when none supplied", () => {
    const body = buildInternationalCreateBody(usInput({ currency: undefined }), "wh")
    expect(body.currency).toBe("INR")
  })
})

describe("ShiprocketClient.createShipment — international routing", () => {
  let fetchSpy: jest.SpyInstance
  afterEach(() => fetchSpy?.mockRestore())

  const make = (body: any, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as any

  it("routes a non-India destination through /international/* and returns an AWB", async () => {
    const hits: string[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        hits.push(url.replace("https://apiv2.shiprocket.in/v1/external", ""))
        if (url.includes("/international/orders/create/adhoc"))
          return make({ shipment_id: 700, order_id: 800 })
        if (url.includes("/international/courier/serviceability"))
          return make({
            data: {
              recommended_courier_company_id: 91,
              available_courier_companies: [
                { courier_company_id: 91, courier_name: "DHL Express", rate: 1200, currency: "INR" },
              ],
            },
          })
        if (url.includes("/international/courier/assign/awb"))
          return make({
            response: { data: { awb_code: "INTLAWB1", courier_company_id: 91, courier_name: "DHL Express" } },
          })
        if (url.endsWith("/courier/generate/label"))
          return make({ label_url: "https://shiprocket/intl-label.pdf" })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    const result = await client.createShipment(usInput())

    expect(result.awb).toBe("INTLAWB1")
    expect(result.label_url).toBe("https://shiprocket/intl-label.pdf")
    expect(result.provider_refs).toMatchObject({
      shipment_id: 700,
      sr_order_id: 800,
      international: true,
    })
    // It hit the international create + serviceability + assign endpoints.
    expect(hits.some((h) => h.includes("/international/orders/create/adhoc"))).toBe(true)
    expect(hits.some((h) => h.includes("/international/courier/serviceability"))).toBe(true)
    expect(hits.some((h) => h.includes("/international/courier/assign/awb"))).toBe(true)
    // ...and NOT the domestic create.
    expect(hits.some((h) => h === "/orders/create/adhoc")).toBe(false)
  })

  it("resolves the recommended courier via order_id serviceability (post-create) and passes it to assign", async () => {
    // Live-verified (#1111): intl serviceability only answers in the `order_id`
    // mode, so the lookup must run AFTER create with the returned SR order id,
    // and the recommended courier must be forwarded to assign/awb.
    const hits: { url: string; body?: any }[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        const path = url.replace("https://apiv2.shiprocket.in/v1/external", "")
        hits.push({ url: path, body: init.body ? JSON.parse(init.body) : undefined })
        if (path.includes("/international/orders/create/adhoc"))
          return make({ shipment_id: 700, order_id: 800 })
        if (path.includes("/international/courier/serviceability"))
          return make({
            data: {
              recommended_courier_company_id: 140,
              available_courier_companies: [
                { courier_company_id: 326, courier_name: "India Post", rate: 900, currency: "USD" },
                { courier_company_id: 140, courier_name: "SRX Premium Pro", rate: 1500, currency: "USD" },
              ],
            },
          })
        if (path.includes("/international/courier/assign/awb"))
          return make({ response: { data: { awb_code: "INTLAWB2", courier_company_id: 140 } } })
        if (path.endsWith("/courier/generate/label")) return make({ label_url: "x.pdf" })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    const result = await client.createShipment(usInput())
    expect(result.awb).toBe("INTLAWB2")

    // serviceability was queried by the created SR order_id (not country/weight).
    const svc = hits.find((h) => h.url.includes("/international/courier/serviceability"))
    expect(svc?.url).toContain("order_id=800")
    expect(svc?.url).not.toContain("delivery_country")
    // ...and its recommended courier (140) rode along on the assign body.
    const assign = hits.find((h) => h.url.includes("/international/courier/assign/awb"))
    expect(assign?.body?.courier_id).toBe(140)
    // Serviceability ran AFTER create (order_id only exists post-create).
    const createIdx = hits.findIndex((h) => h.url.includes("/international/orders/create/adhoc"))
    const svcIdx = hits.findIndex((h) => h.url.includes("/international/courier/serviceability"))
    expect(svcIdx).toBeGreaterThan(createIdx)
  })

  it("keeps a domestic (India) destination on the domestic endpoints", async () => {
    const hits: string[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        hits.push(url.replace("https://apiv2.shiprocket.in/v1/external", ""))
        if (url.endsWith("/orders/create/adhoc")) return make({ shipment_id: 1, order_id: 2 })
        if (url.endsWith("/courier/assign/awb"))
          return make({ response: { data: { awb_code: "DOM1", courier_company_id: 5 } } })
        if (url.endsWith("/courier/generate/label")) return make({ label_url: "d.pdf" })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    const result = await client.createShipment(
      usInput({ to: { ...usInput().to, country: "IN", city: "Jaipur", state: "RJ", pincode: "302001" } })
    )

    expect(result.awb).toBe("DOM1")
    expect(hits.some((h) => h.includes("/international/"))).toBe(false)
    expect(hits).toContain("/orders/create/adhoc")
  })
})
