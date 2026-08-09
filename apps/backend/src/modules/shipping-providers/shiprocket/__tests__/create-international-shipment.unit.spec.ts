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
  // 8-digit ITC-HS (6214.10.10, silk scarves). The fixture used to carry the
  // 4-digit "6214", which `/international/*` rejects outright — so every test
  // built on it was asserting against a body the carrier would never accept.
  items: [{ name: "Silk Scarf", sku: "SCARF-1", quantity: 2, unit_price: 40, hsn: "62141010" }],
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
  // "C" (export against IGST payment), not "A". A complete commercial export
  // body classifies as CSB-5 at Shiprocket, and CSB-5 rejects "A" at create
  // time: "IGST can not be Not Applicable in case of CSB5 shipments."
  // (live-verified). "C" rather than "B" because the LUT has no ARN yet —
  // claiming LUT/bond without one on file would be a false declaration.
  it("defaults to a commercial FOB export declaring IGST paid", () => {
    expect(resolveCustomsDefaults()).toEqual({
      reasonOfExport: 3,
      purpose_of_shipment: 2,
      Terms_Of_Invoice: "FOB",
      igstPaymentStatus: "C",
      commodity: true,
    })
  })
  it("honours caller overrides", () => {
    expect(
      resolveCustomsDefaults({ reason_of_export: 2, terms_of_invoice: "CIF" })
    ).toMatchObject({ reasonOfExport: 2, Terms_Of_Invoice: "CIF" })
  })
  it("switches to LUT/bond once the exporter has one on file", () => {
    expect(
      resolveCustomsDefaults({ igst_payment_status: "B" })
    ).toMatchObject({ igstPaymentStatus: "B" })
  })
  it("takes the account-wide default from the environment", () => {
    const prev = process.env.SHIPROCKET_IGST_PAYMENT_STATUS
    process.env.SHIPROCKET_IGST_PAYMENT_STATUS = "B"
    try {
      expect(resolveCustomsDefaults()).toMatchObject({ igstPaymentStatus: "B" })
      // An explicit per-shipment value still wins over the env.
      expect(
        resolveCustomsDefaults({ igst_payment_status: "C" })
      ).toMatchObject({ igstPaymentStatus: "C" })
    } finally {
      if (prev === undefined) delete process.env.SHIPROCKET_IGST_PAYMENT_STATUS
      else process.env.SHIPROCKET_IGST_PAYMENT_STATUS = prev
    }
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
      igstPaymentStatus: "C",
      commodity: true,
      sub_total: 80,
    })
    expect(body.order_items[0]).toMatchObject({ sku: "SCARF-1", hsn: "62141010", units: 2 })
    // Insurance opted OUT explicitly. `is_insurance_opt` is the only field that
    // moves it (live-verified 2026-08-08: 1 ⇒ opted, 0/absent ⇒ not) — sending 0
    // keeps us opted out even if the account's auto-insurance toggle is flipped,
    // instead of silently paying a premium (a live IL quote wanted 362.39).
    expect(body.is_insurance_opt).toBe(0)
  })

  // The bug behind `assign/awb` 400 ["Delivery pincode is empty","Customer phone
  // is empty"]: the international pipeline does NOT honour shipping_is_billing,
  // so the delivery block has to be sent field-by-field.
  it("sends an explicit shipping_* delivery block rather than relying on shipping_is_billing", () => {
    const body = buildInternationalCreateBody(usInput(), "warehouse-abc")
    expect(body.shipping_is_billing).toBe(false)
    expect(body).toMatchObject({
      shipping_pincode: body.billing_pincode,
      shipping_phone: body.billing_phone,
      shipping_address: body.billing_address,
      shipping_city: body.billing_city,
      shipping_state: body.billing_state,
      shipping_country: "United States",
    })
    for (const f of ["shipping_pincode", "shipping_phone"] as const) {
      expect(String(body[f] ?? "")).not.toBe("")
    }
  })

  it.each([
    ["phone", { phone: "" }],
    ["pincode", { pincode: "" }],
    ["address", { address_1: "" }],
    ["city", { city: "" }],
  ])(
    "refuses to build a body missing the delivery %s (carrier 400s two calls later)",
    (field, patch) => {
      const input = usInput()
      Object.assign(input.to, patch)
      expect(() => buildInternationalCreateBody(input, "warehouse-abc")).toThrow(
        new RegExp(field)
      )
    }
  )

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

  it("normalizes a formatted HSN to digits (Shiprocket 422: 'HSN should be numeric')", () => {
    const body = buildInternationalCreateBody(
      usInput({
        items: [{ name: "Shirt", sku: "S-1", quantity: 1, unit_price: 20, hsn: "6205.20.00" }],
      }),
      "wh"
    )
    expect(body.order_items[0].hsn).toBe("62052000")
  })

  it("treats a non-numeric HSN as missing rather than posting it invalid", () => {
    const input = usInput({
      items: [{ name: "Shirt", sku: "S-1", quantity: 1, unit_price: 20, hsn: "N/A" }],
    })
    expect(() => buildInternationalCreateBody(input, "wh")).toThrow(/HSN code is required/i)
  })

  /**
   * The live 422 this guard exists for, reproduced from order 79 (2026-08-07):
   *   "order_items.0.hsn: The order_items.0.hsn must be at least 8 characters"
   *   … repeated for every line.
   *
   * All six products carried a 6-digit WCO heading, which the DOMESTIC endpoint
   * accepts (documented 1–15) and `normalizeHsCode` therefore allows. The failure
   * was invisible until the carrier saw it.
   */
  it("rejects a 6-digit HSN before the call (422: 'must be at least 8 characters')", () => {
    const input = usInput({
      items: [
        { name: "Garpön Kala Cotton Shirt", sku: "S-1", quantity: 1, unit_price: 20, hsn: "620520" },
        { name: "Lamyig Canvas Carryall", sku: "S-2", quantity: 1, unit_price: 30, hsn: "420222" },
      ],
    })
    expect(() => buildInternationalCreateBody(input, "wh")).toThrow(
      /at least|8-digit/i
    )
  })

  it("names every short line and its current code, so one fix clears them all", () => {
    const input = usInput({
      items: [
        { name: "Shirt", sku: "S-1", quantity: 1, unit_price: 20, hsn: "620520" },
        { name: "Carryall", sku: "S-2", quantity: 1, unit_price: 30, hsn: "420222" },
        { name: "Apron", sku: "S-3", quantity: 1, unit_price: 15, hsn: "62114900" },
      ],
    })
    try {
      buildInternationalCreateBody(input, "wh")
      throw new Error("expected a throw")
    } catch (e: any) {
      expect(e.message).toMatch(/Shirt \(620520\)/)
      expect(e.message).toMatch(/Carryall \(420222\)/)
      // The already-valid 8-digit line must NOT be blamed.
      expect(e.message).not.toMatch(/Apron/)
    }
  })

  /**
   * Zero-padding 6→8 is deliberately NOT done. The last two digits are an Indian
   * national subheading: 4202.22 splits into 42022210/20/30/40/90 and there is no
   * 42022200, so padding would invent a tariff line and declare it to customs.
   */
  it("does not pad a short HSN to 8 digits", () => {
    const input = usInput({
      items: [{ name: "Carryall", sku: "S-2", quantity: 1, unit_price: 30, hsn: "420222" }],
    })
    expect(() => buildInternationalCreateBody(input, "wh")).toThrow()
    // …rather than silently producing "42022200".
  })

  it("accepts a full 8-digit ITC-HS code", () => {
    const body = buildInternationalCreateBody(
      usInput({
        items: [{ name: "Shirt", sku: "S-1", quantity: 1, unit_price: 20, hsn: "62052000" }],
      }),
      "wh"
    )
    expect(body.order_items[0].hsn).toBe("62052000")
  })

  /**
   * Live-verified 2026-08-08, order 79 → IL. `create/adhoc` returned 200 but
   * `assign/awb` 400'd with ["Delivery pincode is empty","Customer phone is
   * empty"] — on an address carrying BOTH. IL was absent from the 20-country
   * dial-code map, so `isd_code` was silently omitted; Shiprocket then failed to
   * register the phone and dropped the whole shipping_* block, which is why the
   * pincode is also reported missing. The US order this path was verified
   * against on 2026-08-06 carried `+1` and assigned fine.
   */
  it("sends isd_code for a destination outside the original 20-country map (IL)", () => {
    const body = buildInternationalCreateBody(
      usInput({ to: { ...usInput().to, country: "IL", pincode: "9339904", phone: "+972548043774" } as any }),
      "wh"
    )
    expect(body.isd_code).toBe("+972")
    // The delivery block must still be explicit — the flag is not honoured.
    expect(body.shipping_is_billing).toBe(false)
    expect(body.shipping_pincode).toBe("9339904")
    // The phone goes as the NATIONAL number: Shiprocket concatenates `isd_code`
    // onto it, so echoing the stored E.164 back here produced the doubled
    // `+972-+972548043774` seen on prod labels. This assertion previously
    // pinned that doubling.
    expect(body.shipping_phone).toBe("548043774")
  })

  it("refuses to build a body for a country with no dial code, naming the real gap", () => {
    expect(() =>
      buildInternationalCreateBody(
        usInput({ to: { ...usInput().to, country: "ZZ" } as any }),
        "wh"
      )
    ).toThrow(/ISD dial code/i)
  })

  it("falls back billing_state to the city when the address has none (422: 'billing state field is required')", () => {
    const body = buildInternationalCreateBody(
      usInput({ to: { ...usInput().to, state: "" } as any }),
      "wh"
    )
    expect(body.billing_state).toBe("Dallas")
  })

  it("keeps a real billing_state untouched", () => {
    const body = buildInternationalCreateBody(usInput(), "wh")
    expect(body.billing_state).toBe("Texas")
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
    // The auto-selected courier's quoted rate + currency surface for visibility
    // (S3 auto-select-only): courier 140 was quoted 1500 USD.
    expect(result.provider_refs).toMatchObject({
      courier_rate: 1500,
      courier_rate_currency: "usd",
    })
    // Serviceability ran AFTER create (order_id only exists post-create).
    const createIdx = hits.findIndex((h) => h.url.includes("/international/orders/create/adhoc"))
    const svcIdx = hits.findIndex((h) => h.url.includes("/international/courier/serviceability"))
    expect(svcIdx).toBeGreaterThan(createIdx)
  })

  /**
   * Live-verified 2026-08-08, order 79 → IL: the RECOMMENDED courier
   * `SRX Economy (384)` refuses the shipment while `SRX Premium Plus Pro (262)`
   * assigns the identical body/pickup/address instantly. 384's refusal arrives
   * as `["Delivery pincode is empty","Customer phone is empty"]` — on an address
   * Shiprocket has recorded — so the whole label used to die on a message that
   * named fields which were not the problem.
   */
  it("falls through to the next courier when the recommended one refuses", async () => {
    const assigns: any[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        const path = url.replace("https://apiv2.shiprocket.in/v1/external", "")
        if (path.includes("/international/orders/create/adhoc"))
          return make({ shipment_id: 700, order_id: 800 })
        if (path.includes("/international/courier/serviceability"))
          return make({
            data: {
              recommended_courier_company_id: 384,
              available_courier_companies: [
                { courier_company_id: 384, courier_name: "SRX Economy", rate: { rate: 1100 } },
                { courier_company_id: 262, courier_name: "SRX Premium Plus Pro", rate: { rate: 1300 } },
              ],
            },
          })
        if (path.includes("/international/courier/assign/awb")) {
          const body = JSON.parse(init.body)
          assigns.push(body.courier_id)
          // 384 refuses the way the live account does: a 400 naming the wrong fields.
          if (body.courier_id === 384)
            return make(
              { message: '["Delivery pincode is empty","Customer phone is empty"]' },
              400
            )
          return make({
            response: { data: { awb_code: "INTLAWB262", courier_company_id: 262 } },
          })
        }
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

    expect(result.awb).toBe("INTLAWB262")
    // Recommended first, then the fallback — and the refusal did not fail the label.
    expect(assigns).toEqual([384, 262])
    // The refs describe the courier that actually took it, not the recommended one.
    expect(result.provider_refs).toMatchObject({ courier_company_id: 262 })
  })

  it("fails naming every courier and its own reason once all refuse", async () => {
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        const path = url.replace("https://apiv2.shiprocket.in/v1/external", "")
        if (path.includes("/international/orders/create/adhoc"))
          return make({ shipment_id: 700, order_id: 800 })
        if (path.includes("/international/courier/serviceability"))
          return make({
            data: {
              recommended_courier_company_id: 384,
              available_courier_companies: [
                { courier_company_id: 384, courier_name: "SRX Economy", rate: { rate: 1100 } },
                { courier_company_id: 262, courier_name: "SRX Premium Plus Pro", rate: { rate: 1300 } },
              ],
            },
          })
        if (path.includes("/international/courier/assign/awb")) {
          const body = JSON.parse(init.body)
          // The other live shape: HTTP 200 with awb_assign_status 0 and no AWB.
          if (body.courier_id === 262)
            return make({
              awb_assign_status: 0,
              response: { data: "Courier is facing some issues, Please try after sometime." },
            })
          return make({ message: '["Delivery pincode is empty"]' }, 400)
        }
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    await expect(client.createShipment(usInput())).rejects.toThrow(
      /No international courier would accept this shipment.*SRX Economy \(384\).*SRX Premium Plus Pro \(262\).*facing some issues/s
    )
  })

  /**
   * #1225 — this is the shape that stranded a carrier order per retry on order
   * 79: the create succeeds, every courier refuses, and the order stays behind
   * as a live "New" row nothing references. Sweep it on the way out.
   */
  it("cancels the carrier order it created once every courier has refused", async () => {
    const cancels: any[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        const path = url.replace("https://apiv2.shiprocket.in/v1/external", "")
        if (path.includes("/international/orders/create/adhoc"))
          return make({ shipment_id: 700, order_id: 800 })
        if (path.includes("/international/courier/serviceability"))
          return make({
            data: {
              recommended_courier_company_id: 384,
              available_courier_companies: [
                { courier_company_id: 384, courier_name: "SRX Economy", rate: { rate: 1100 } },
              ],
            },
          })
        if (path.includes("/international/courier/assign/awb"))
          return make({ message: '["Delivery pincode is empty"]' }, 400)
        if (path === "/orders/cancel") {
          cancels.push(JSON.parse(String(init.body || "{}")))
          return make({ status: 200 })
        }
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    await expect(client.createShipment(usInput())).rejects.toThrow(
      /No international courier would accept this shipment/
    )
    expect(cancels).toEqual([{ ids: [800] }])
  })

  /**
   * THE order-79 bug. `create/adhoc` dedupes on the channel `order_id`, so a
   * reference whose carrier order was cancelled resolves back to that dead
   * record — HTTP 200, `status: "CANCELED"`, the OLD shipment_id — and assign
   * then blames the delivery pincode. Live-verified: creating with order 79's id
   * returned sr_order 1499133560 / shipment 1495356234, cancelled on 6 Aug.
   */
  it("recreates under a fresh channel id when the carrier returns a CANCELED order", async () => {
    const creates: string[] = []
    const assigned: any[] = []
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        const path = url.replace("https://apiv2.shiprocket.in/v1/external", "")
        if (path.includes("/international/orders/create/adhoc")) {
          const body = JSON.parse(init.body)
          creates.push(body.order_id)
          // First create resolves to the CANCELLED existing carrier order.
          return creates.length === 1
            ? make({
                order_id: 1499133560,
                shipment_id: 1495356234,
                status: "CANCELED",
                status_code: 5,
              })
            : make({ order_id: 1503999, shipment_id: 1499999, status: "NEW", status_code: 1 })
        }
        if (path.includes("/international/courier/serviceability"))
          return make({
            data: {
              recommended_courier_company_id: 262,
              available_courier_companies: [
                { courier_company_id: 262, courier_name: "SRX Premium Plus Pro", rate: { rate: 1300 } },
              ],
            },
          })
        if (path.includes("/international/courier/assign/awb")) {
          const body = JSON.parse(init.body)
          assigned.push(body.shipment_id[0])
          // The dead shipment refuses exactly as the live account does.
          if (body.shipment_id[0] === 1495356234)
            return make(
              { message: '["Delivery pincode is empty","Customer phone is empty"]' },
              400
            )
          return make({ response: { data: { awb_code: "INTLAWB79", courier_company_id: 262 } } })
        }
        if (path.endsWith("/courier/generate/label")) return make({ label_url: "x.pdf" })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    const result = await client.createShipment(usInput({ reference_id: "order_79" } as any))

    expect(result.awb).toBe("INTLAWB79")
    // Recreated under a suffixed channel id, and the dead shipment was NEVER assigned.
    expect(creates[0]).toBe("order_79")
    expect(creates[1]).toMatch(/^order_79-R[a-z0-9]+$/)
    expect(assigned).toEqual([1499999])
    // The refs describe the FRESH carrier order, not the cancelled one.
    expect(result.provider_refs).toMatchObject({ sr_order_id: 1503999, shipment_id: 1499999 })
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
