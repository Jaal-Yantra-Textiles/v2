import { ShiprocketClient } from "../client"

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
})
