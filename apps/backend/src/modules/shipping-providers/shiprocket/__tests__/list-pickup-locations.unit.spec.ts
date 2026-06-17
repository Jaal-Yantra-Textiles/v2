import { ShiprocketClient, normalizePickupLocation } from "../client"

/**
 * #435 — `normalizePickupLocation` decides whether a Shiprocket pickup is
 * *shippable*, not just whether its phone OTP is done. Per the carrier (and a
 * live `/settings/company/pickup` capture), an API-registered pickup with a
 * complete address is usable for live pickups even when `phone_verified` is 0,
 * so the admin must stop showing those as "not verified" / "unknown".
 */
describe("normalizePickupLocation (#435)", () => {
  // Shape mirrors a real `data.shipping_address[]` row.
  const fullAddress = {
    id: 76349863,
    pickup_location: "warehouse-AYV7GRDR",
    address: "Ram Nagar Road, Ward 11",
    city: "Dharamshala",
    state: "Himachal Pradesh",
    pin_code: "176215",
    phone: "9767901992",
    status: 1,
  }

  it("marks a phone-verified pickup with a full address as shippable", () => {
    const p = normalizePickupLocation({ ...fullAddress, phone_verified: 1 })
    expect(p.phone_verified).toBe(true)
    expect(p.address_complete).toBe(true)
    expect(p.shippable).toBe(true)
  })

  it("marks an API pickup with a full address shippable even before phone OTP", () => {
    const p = normalizePickupLocation({ ...fullAddress, phone_verified: 0 })
    expect(p.phone_verified).toBe(false)
    expect(p.address_complete).toBe(true)
    expect(p.shippable).toBe(true) // the core #435 fix
  })

  it("treats a missing phone_verified field as undefined, still shippable on a full address", () => {
    const { ...noFlag } = fullAddress
    const p = normalizePickupLocation(noFlag)
    expect(p.phone_verified).toBeUndefined()
    expect(p.shippable).toBe(true)
  })

  it("is not shippable when the address is incomplete", () => {
    const p = normalizePickupLocation({
      pickup_location: "warehouse-x",
      city: "Jaipur",
      state: "RJ",
      pin_code: "302001",
      phone_verified: 0,
      // no `address`, no `phone`
    })
    expect(p.address_complete).toBe(false)
    expect(p.shippable).toBe(false)
  })

  it("a deactivated pickup (status 0) is not shippable even with a full address", () => {
    const p = normalizePickupLocation({
      ...fullAddress,
      phone_verified: 1,
      status: 0,
    })
    expect(p.shippable).toBe(false)
  })

  it("maps nickname, id and address fields", () => {
    const p = normalizePickupLocation({ ...fullAddress, phone_verified: 1 })
    expect(p.name).toBe("warehouse-AYV7GRDR")
    expect(p.id).toBe(76349863)
    expect(p.city).toBe("Dharamshala")
    expect(p.pincode).toBe("176215")
    expect(p.raw).toMatchObject({ pickup_location: "warehouse-AYV7GRDR" })
  })
})

describe("ShiprocketClient.listPickupLocations (#435)", () => {
  let fetchSpy: jest.SpyInstance
  afterEach(() => fetchSpy?.mockRestore())

  it("normalizes data.shipping_address[] rows through normalizePickupLocation", async () => {
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
        if (url.includes("/settings/company/pickup"))
          return make({
            data: {
              shipping_address: [
                {
                  pickup_location: "warehouse-ready",
                  address: "1 Mill Road",
                  city: "Jaipur",
                  pin_code: "302001",
                  phone: "9999999999",
                  phone_verified: 0,
                  status: 1,
                },
              ],
            },
          })
        return make({}, 404)
      })

    const client = new ShiprocketClient({
      email: "x@y.com",
      password: "p",
      token: "injected-token",
    })

    const list = await client.listPickupLocations()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("warehouse-ready")
    expect(list[0].phone_verified).toBe(false)
    expect(list[0].shippable).toBe(true)
  })
})
