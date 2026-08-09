import { ShiprocketClient, buildShiprocketOrderItems, toRate } from "../client"

/**
 * #404 PR-B — ShiprocketClient.createShipment sequences create-adhoc-order →
 * assign-AWB → generate-label and returns a uniform ShipmentResult. The three
 * Shiprocket endpoints are stubbed via global.fetch (no sandbox API). A token
 * is injected so no /auth/login round-trip is needed.
 */
describe("ShiprocketClient.createShipment (#404 PR-B)", () => {
  let fetchSpy: jest.SpyInstance

  afterEach(() => fetchSpy?.mockRestore())

  it("returns awb + label_url + provider_refs from the bundled flow", async () => {
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        const make = (body: any, status = 200) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
          }) as any
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        if (url.endsWith("/orders/create/adhoc"))
          return make({ shipment_id: 111, order_id: 222 })
        if (url.endsWith("/courier/assign/awb"))
          return make({
            response: {
              data: {
                awb_code: "AWB123",
                courier_company_id: 5,
                courier_name: "Test Courier",
              },
            },
          })
        if (url.endsWith("/courier/generate/label"))
          return make({ label_url: "https://shiprocket/label.pdf" })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token", // skips /auth/login
      pickup_location: "warehouse-abc",
    })

    const result = await client.createShipment({
      reference_id: "order_1",
      payment_mode: "prepaid",
      pickup_location_name: "warehouse-abc",
      to: {
        name: "Asha Rao",
        phone: "+919800000000",
        address_1: "12 MG Road",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001",
        country: "IN",
      },
      items: [{ name: "Saree", quantity: 1, unit_price: 250 }],
      weight_grams: 500,
      sub_total: 250,
    })

    expect(result.carrier).toBe("shiprocket")
    expect(result.awb).toBe("AWB123")
    expect(result.tracking_number).toBe("AWB123")
    expect(result.label_url).toBe("https://shiprocket/label.pdf")
    expect(result.provider_refs).toMatchObject({
      shipment_id: 111,
      sr_order_id: 222,
      courier_company_id: 5,
    })
  })

  it("re-creates under a suffixed channel id when the AWB assign hits a cancelled carrier order", async () => {
    // Shiprocket dedupes adhoc orders on the channel order_id FOREVER — a
    // cancelled carrier order squats on the id, the create returns that dead
    // record, and assign/awb 500s "order is in cancelled state". The client
    // must retry once under `<reference>-R<suffix>`.
    const real = global.fetch?.bind(globalThis)
    const createBodies: any[] = []
    let assignCalls = 0
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        const make = (body: any, status = 200) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
          }) as any
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        if (url.endsWith("/orders/create/adhoc")) {
          const body = JSON.parse(init.body)
          createBodies.push(body)
          // First create resolves to the CANCELLED existing order; the
          // suffixed retry gets a fresh shipment.
          return createBodies.length === 1
            ? make({ shipment_id: 111, order_id: 222 })
            : make({ shipment_id: 333, order_id: 444 })
        }
        if (url.endsWith("/courier/assign/awb")) {
          assignCalls++
          if (assignCalls === 1)
            return make(
              { message: "order is in cancelled state.", status_code: 500 },
              500
            )
          return make({
            response: {
              data: {
                awb_code: "AWB999",
                courier_company_id: 7,
                courier_name: "Retry Courier",
              },
            },
          })
        }
        if (url.endsWith("/courier/generate/label"))
          return make({ label_url: "https://shiprocket/label2.pdf" })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    const result = await client.createShipment({
      reference_id: "inv_order_CANCELLED1",
      payment_mode: "prepaid",
      pickup_location_name: "warehouse-abc",
      to: {
        name: "Asha Rao",
        phone: "+919800000000",
        address_1: "12 MG Road",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001",
        country: "IN",
      },
      items: [{ name: "Saree", quantity: 1, unit_price: 250 }],
      weight_grams: 500,
      sub_total: 250,
    })

    // Domestic opts out of shipment insurance explicitly too — same field, same
    // reason as the international body (don't inherit the account toggle).
    expect(createBodies[0].is_insurance_opt).toBe(0)
    // Two creates: the original reference, then the suffixed retry.
    expect(createBodies).toHaveLength(2)
    expect(createBodies[0].order_id).toBe("inv_order_CANCELLED1")
    expect(createBodies[1].order_id).toMatch(/^inv_order_CANCELLED1-R[a-z0-9]+$/)
    expect(assignCalls).toBe(2)
    // The result reflects the FRESH carrier order, not the cancelled one.
    expect(result.awb).toBe("AWB999")
    expect(result.provider_refs).toMatchObject({
      shipment_id: 333,
      sr_order_id: 444,
    })
  })

  it("does not retry on a non-cancelled assign failure", async () => {
    const real = global.fetch?.bind(globalThis)
    let createCalls = 0
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        const make = (body: any, status = 200) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
          }) as any
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        if (url.endsWith("/orders/create/adhoc")) {
          createCalls++
          return make({ shipment_id: 111, order_id: 222 })
        }
        if (url.endsWith("/courier/assign/awb"))
          return make({ message: "no couriers serviceable", status_code: 422 }, 422)
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })

    await expect(
      client.createShipment({
        reference_id: "inv_order_OTHERFAIL",
        payment_mode: "prepaid",
        pickup_location_name: "warehouse-abc",
        to: {
          name: "Asha Rao",
          phone: "+919800000000",
          address_1: "12 MG Road",
          city: "Bengaluru",
          state: "KA",
          pincode: "560001",
          country: "IN",
        },
        items: [{ name: "Saree", quantity: 1, unit_price: 250 }],
        weight_grams: 500,
        sub_total: 250,
      })
    ).rejects.toThrow(/no couriers serviceable/)
    expect(createCalls).toBe(1)
  })

  /**
   * #1225 — a failed assign used to leave the created carrier order behind.
   * Nothing on our side persists a reference to it (the caller only writes
   * `fulfillment.data` on success), so it became a live orphan in the Shiprocket
   * dashboard, one per retry, swept by hand.
   */
  describe("orphan cleanup on a failed assign (#1225)", () => {
    const stub = (opts: {
      created: any
      assign: () => any
      cancels: any[]
      status?: number
    }) => {
      const real = global.fetch?.bind(globalThis)
      return jest
        .spyOn(global, "fetch" as any)
        .mockImplementation(async (input: any, init: any = {}) => {
          const url = String(input)
          const make = (body: any, status = 200) =>
            ({
              ok: status >= 200 && status < 300,
              status,
              json: async () => body,
              text: async () => JSON.stringify(body),
            }) as any
          if (!url.includes("shiprocket.in")) return real?.(input, init)
          if (url.endsWith("/orders/create/adhoc")) return make(opts.created)
          if (url.endsWith("/courier/assign/awb"))
            return make(opts.assign(), opts.status ?? 200)
          if (url.endsWith("/orders/cancel")) {
            opts.cancels.push(JSON.parse(String(init?.body || "{}")))
            return make({ status: 200, message: "Order cancelled" })
          }
          return make({}, 404)
        })
    }

    const input = (reference_id: string) => ({
      reference_id,
      payment_mode: "prepaid" as const,
      pickup_location_name: "warehouse-abc",
      to: {
        name: "Asha Rao",
        phone: "+919800000000",
        address_1: "12 MG Road",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001",
        country: "IN",
      },
      items: [{ name: "Saree", quantity: 1, unit_price: 250 }],
      weight_grams: 500,
      sub_total: 250,
    })

    const client = () =>
      new ShiprocketClient({
        email: "x@y.com",
        password: "p",
        token: "injected-token",
        pickup_location: "warehouse-abc",
      })

    it("cancels the order it created, and still throws the carrier's own error", async () => {
      const cancels: any[] = []
      fetchSpy = stub({
        created: { shipment_id: 111, order_id: 222 },
        assign: () => ({ message: "no couriers serviceable" }),
        status: 422,
        cancels,
      })

      await expect(client().createShipment(input("order_orphan"))).rejects.toThrow(
        /no couriers serviceable/
      )
      expect(cancels).toEqual([{ ids: [222] }])
    })

    it("cancels a 200 that carried no waybill at all", async () => {
      const cancels: any[] = []
      fetchSpy = stub({
        created: { shipment_id: 111, order_id: 222 },
        // 200 with an empty AWB — a refusal that never throws, so it used to
        // strand the order past `assertAwbAssigned`.
        assign: () => ({ response: { data: { awb_code: "" } } }),
        cancels,
      })

      await expect(client().createShipment(input("order_noawb"))).rejects.toThrow()
      expect(cancels).toEqual([{ ids: [222] }])
    })

    it("never cancels an order that already carries an AWB", async () => {
      const cancels: any[] = []
      fetchSpy = stub({
        // `create/adhoc` dedupes on the channel order id, so this can be a
        // PRE-EXISTING shipment that is already moving. Cancelling it on our
        // assign failure would kill a real delivery.
        created: { shipment_id: 111, order_id: 222, awb_code: "LIVE1" },
        assign: () => ({ message: "AWB already assigned" }),
        status: 400,
        cancels,
      })

      await expect(client().createShipment(input("order_live"))).rejects.toThrow(
        /AWB already assigned/
      )
      expect(cancels).toEqual([])
    })

    it("keeps the carrier error when the cleanup call itself fails", async () => {
      const real = global.fetch?.bind(globalThis)
      fetchSpy = jest
        .spyOn(global, "fetch" as any)
        .mockImplementation(async (i: any, init: any = {}) => {
          const url = String(i)
          const make = (body: any, status = 200) =>
            ({
              ok: status >= 200 && status < 300,
              status,
              json: async () => body,
              text: async () => JSON.stringify(body),
            }) as any
          if (!url.includes("shiprocket.in")) return real?.(i, init)
          if (url.endsWith("/orders/create/adhoc"))
            return make({ shipment_id: 111, order_id: 222 })
          if (url.endsWith("/courier/assign/awb"))
            return make({ message: "no couriers serviceable" }, 422)
          // Cleanup is best-effort: the operator needs the ORIGINAL failure, not
          // a message about cancellation.
          return make({ message: "cancellation not allowed" }, 403)
        })

      await expect(client().createShipment(input("order_cleanupfail"))).rejects.toThrow(
        /no couriers serviceable/
      )
    })
  })
})

describe("buildShiprocketOrderItems (dedupe repeated SKUs)", () => {
  it("merges rows sharing a SKU, summing units (Shiprocket rejects repeats)", () => {
    const rows = buildShiprocketOrderItems([
      { name: "Linen — Red", sku: "LIN-1", quantity: 3, unit_price: 50 },
      { name: "Linen — Blue", sku: "LIN-1", quantity: 2, unit_price: 50 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].sku).toBe("LIN-1")
    expect(rows[0].units).toBe(5)
    expect(rows[0].name).toBe("Linen — Red") // first row's name kept
  })

  it("falls back to the item name as SKU and merges name collisions", () => {
    const rows = buildShiprocketOrderItems([
      { name: "Handloom Cotton", quantity: 4, unit_price: 80 },
      { name: "Handloom Cotton", quantity: 1, unit_price: 80 },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].sku).toBe("Handloom Cotton")
    expect(rows[0].units).toBe(5)
  })

  it("keeps distinct SKUs separate and preserves order", () => {
    const rows = buildShiprocketOrderItems([
      { name: "A", sku: "A-1", quantity: 1, unit_price: 10 },
      { name: "B", sku: "B-1", quantity: 2, unit_price: 20 },
      { name: "A again", sku: "A-1", quantity: 3, unit_price: 10 },
    ])
    expect(rows.map((r) => r.sku)).toEqual(["A-1", "B-1"])
    expect(rows[0].units).toBe(4)
    expect(rows[1].units).toBe(2)
  })

  it("carries hsn/tax through and defaults them", () => {
    const rows = buildShiprocketOrderItems([
      { name: "X", sku: "X-1", quantity: 1, unit_price: 5, hsn: "5208", tax: 5 },
      { name: "Y", sku: "Y-1", quantity: 1, unit_price: 5 },
    ])
    expect(rows[0]).toMatchObject({ hsn: "5208", tax: 5 })
    expect(rows[1]).toMatchObject({ hsn: "", tax: "" })
  })
})

/**
 * Platform shipping cost — the DOMESTIC assign/awb response carries the freight
 * charge, which used to be dropped on the floor (only the international path
 * stamped a rate). Without it a domestic label left no cost trace, so a
 * partner's payout couldn't show what our shipping actually cost them.
 */
describe("toRate (carrier freight charge coercion)", () => {
  it("parses numbers and numeric strings", () => {
    expect(toRate(84)).toBe(84)
    expect(toRate("84.50")).toBe(84.5)
  })

  it("keeps a genuine zero — free shipping is a real rate", () => {
    expect(toRate(0)).toBe(0)
    expect(toRate("0")).toBe(0)
  })

  it("returns undefined for absent or unparseable values rather than 0", () => {
    // Collapsing these to 0 would silently under-deduct a partner's payout.
    expect(toRate(undefined)).toBeUndefined()
    expect(toRate(null)).toBeUndefined()
    expect(toRate("")).toBeUndefined()
    expect(toRate("N/A")).toBeUndefined()
  })
})

describe("ShiprocketClient.createShipment — domestic courier rate", () => {
  let fetchSpy: jest.SpyInstance

  afterEach(() => fetchSpy?.mockRestore())

  const stubFetch = (awbData: Record<string, any>) => {
    const real = global.fetch?.bind(globalThis)
    fetchSpy = jest
      .spyOn(global, "fetch" as any)
      .mockImplementation(async (input: any, init: any = {}) => {
        const url = String(input)
        const make = (body: any, status = 200) =>
          ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
          }) as any
        if (!url.includes("shiprocket.in")) return real?.(input, init)
        if (url.endsWith("/orders/create/adhoc"))
          return make({ shipment_id: 111, order_id: 222 })
        if (url.endsWith("/courier/assign/awb"))
          return make({ response: { data: awbData } })
        if (url.endsWith("/courier/generate/label"))
          return make({ label_url: "https://shiprocket/label.pdf" })
        return make({}, 404)
      })
  }

  const ship = () => {
    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
      pickup_location: "warehouse-abc",
    })
    return client.createShipment({
      reference_id: "order_rate",
      payment_mode: "prepaid",
      pickup_location_name: "warehouse-abc",
      to: {
        name: "Asha Rao",
        phone: "+919800000000",
        address_1: "12 MG Road",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001",
        country: "IN",
      },
      items: [{ name: "Saree", quantity: 1, unit_price: 250 }],
      weight_grams: 500,
      sub_total: 250,
    })
  }

  it("stamps freight_charges as courier_rate in account currency", async () => {
    stubFetch({
      awb_code: "AWB123",
      courier_company_id: 5,
      courier_name: "Test Courier",
      freight_charges: "84.50",
    })
    const result = await ship()
    expect(result.provider_refs).toMatchObject({
      courier_rate: 84.5,
      courier_rate_currency: "INR",
    })
  })

  it("omits the rate entirely when the courier returns none", async () => {
    // An absent rate must not become 0 — the payout would deduct nothing and
    // claim we shipped for free.
    stubFetch({
      awb_code: "AWB123",
      courier_company_id: 5,
      courier_name: "Test Courier",
    })
    const result = await ship()
    expect(result.provider_refs).not.toHaveProperty("courier_rate")
    expect(result.provider_refs).toMatchObject({ courier_name: "Test Courier" })
  })
})
