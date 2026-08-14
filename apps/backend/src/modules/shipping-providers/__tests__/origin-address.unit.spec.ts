import { originAddressFromLocation } from "../origin-address"

/**
 * The ship-from address Blue Dart puts on the waybill. `CreateShipmentInput.from`
 * went unpopulated since the #31 spike, which cost nothing while Shiprocket and
 * Delhivery derived their origin from a registered pickup — and produced a bare,
 * empty-bodied 400 the first time a Blue Dart waybill was generated on prod.
 */

const LOCATION = {
  id: "sloc_1",
  name: "warehouse-AYV7GRDR",
  address: {
    address_1: "Ram Nagar Road Sharlho Factory , Ward 11",
    address_2: "Near Nandini Villa",
    company: "JYT",
    city: "Dhramshala",
    province: "Himachal Nagar",
    postal_code: "176215",
    country_code: "in",
    phone: "7580067026",
  },
}

describe("originAddressFromLocation", () => {
  it("maps a complete stock location onto a shipment address", () => {
    expect(originAddressFromLocation(LOCATION)).toEqual({
      name: "JYT",
      phone: "7580067026",
      address_1: "Ram Nagar Road Sharlho Factory , Ward 11",
      address_2: "Near Nandini Villa",
      city: "Dhramshala",
      state: "Himachal Nagar",
      pincode: "176215",
      country: "IN",
    })
  })

  it("prefers the company over the location name", () => {
    // The location name is routinely the derived `warehouse-<last8>` handle
    // (#1234) — a routing key, not something a courier or customs officer reads.
    expect(originAddressFromLocation(LOCATION)!.name).toBe("JYT")
    expect(
      originAddressFromLocation({
        ...LOCATION,
        address: { ...LOCATION.address, company: null },
      })!.name
    ).toBe("warehouse-AYV7GRDR")
  })

  it("returns undefined without a street line or a pincode", () => {
    // A half-filled origin fails Blue Dart's block validation exactly as a blank
    // one does, while an absent `from` keeps Shiprocket and Delhivery working.
    expect(
      originAddressFromLocation({
        ...LOCATION,
        address: { ...LOCATION.address, postal_code: "  " },
      })
    ).toBeUndefined()
    expect(
      originAddressFromLocation({
        ...LOCATION,
        address: { ...LOCATION.address, address_1: "" },
      })
    ).toBeUndefined()
  })

  it("returns undefined for a location with no address at all", () => {
    expect(originAddressFromLocation({ id: "sloc_1", name: "x" })).toBeUndefined()
    expect(originAddressFromLocation(null)).toBeUndefined()
    expect(originAddressFromLocation(undefined)).toBeUndefined()
  })

  it("still maps a location missing its phone — 17 of 22 prod locations are (#1236)", () => {
    const addr = originAddressFromLocation({
      ...LOCATION,
      address: { ...LOCATION.address, phone: null },
    })!
    expect(addr.phone).toBe("")
    expect(addr.pincode).toBe("176215")
  })

  it("drops an empty address_2 rather than sending a blank line", () => {
    expect(
      originAddressFromLocation({
        ...LOCATION,
        address: { ...LOCATION.address, address_2: "   " },
      })!.address_2
    ).toBeUndefined()
  })

  it("defaults the country to IN and normalises its case", () => {
    expect(originAddressFromLocation(LOCATION)!.country).toBe("IN")
    expect(
      originAddressFromLocation({
        ...LOCATION,
        address: { ...LOCATION.address, country_code: null },
      })!.country
    ).toBe("IN")
  })
})
