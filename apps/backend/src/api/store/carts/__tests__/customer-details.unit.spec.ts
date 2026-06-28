import { buildCartUpdate, splitName } from "../[id]/customer-details/lib"

describe("splitName", () => {
  it("prefers explicit first/last", () => {
    expect(splitName("Ignored", "Asha", "Buyer")).toEqual({ first_name: "Asha", last_name: "Buyer" })
  })
  it("splits a full name into first + rest", () => {
    expect(splitName("Asha Maria Buyer")).toEqual({ first_name: "Asha", last_name: "Maria Buyer" })
  })
  it("handles a single-token name", () => {
    expect(splitName("Asha")).toEqual({ first_name: "Asha" })
  })
  it("returns empty for no name", () => {
    expect(splitName(undefined)).toEqual({})
  })
})

describe("buildCartUpdate", () => {
  const full = {
    name: "Asha Buyer",
    email: "asha@jyt.test",
    phone: "+1 555 0100",
    address_1: "1 Market St",
    city: "New York",
    postal_code: "10001",
    country_code: "US",
  }

  it("assembles email + shipping and mirrors billing by default", () => {
    const { payload, missing } = buildCartUpdate(full)
    expect(missing).toEqual([])
    expect(payload.email).toBe("asha@jyt.test")
    expect(payload.shipping_address).toMatchObject({
      first_name: "Asha",
      last_name: "Buyer",
      address_1: "1 Market St",
      city: "New York",
      postal_code: "10001",
      country_code: "us", // lower-cased
    })
    expect(payload.billing_address).toEqual(payload.shipping_address)
  })

  it("does not mirror billing when billing_same_as_shipping is false", () => {
    const { payload } = buildCartUpdate({ ...full, billing_same_as_shipping: false })
    expect(payload.billing_address).toBeUndefined()
  })

  it("uses an explicit billing_address when given", () => {
    const { payload } = buildCartUpdate({ ...full, billing_address: { city: "Boston", address_1: "" } })
    expect(payload.billing_address).toEqual({ city: "Boston" }) // empty dropped
  })

  it("reports every missing required field (including name)", () => {
    const { missing } = buildCartUpdate({ country_code: "us" })
    expect(missing).toEqual(
      expect.arrayContaining(["email", "address_1", "city", "postal_code", "name"])
    )
    expect(missing).not.toContain("country_code")
  })

  it("never includes blank values in the shipping payload", () => {
    const { payload } = buildCartUpdate({ ...full, address_2: "", company: "" })
    expect(payload.shipping_address).not.toHaveProperty("address_2")
    expect(payload.shipping_address).not.toHaveProperty("company")
  })
})
