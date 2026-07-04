import { pickPartnerShipFromLocation } from "../lib/ship-from-location"

/**
 * #772 core-order half — deterministic selection of the partner's ship-from
 * location among the ones linked to their default sales channel.
 */
describe("pickPartnerShipFromLocation", () => {
  it("returns null for no candidates", () => {
    expect(pickPartnerShipFromLocation(null)).toBeNull()
    expect(pickPartnerShipFromLocation([])).toBeNull()
    expect(pickPartnerShipFromLocation([{ id: "" } as any])).toBeNull()
  })

  it("returns the only candidate", () => {
    const only = { id: "sloc_1" }
    expect(pickPartnerShipFromLocation([only])).toBe(only)
  })

  it("prefers a location already registered as a carrier pickup", () => {
    const picked = pickPartnerShipFromLocation([
      { id: "sloc_a", phone: "999", postal_code: "363035" },
      { id: "sloc_b", pickup_nickname: "warehouse-4NJ4TV9Q" },
      { id: "sloc_c" },
    ])
    expect(picked?.id).toBe("sloc_b")
  })

  it("falls back to a registerable address (phone + pincode)", () => {
    const picked = pickPartnerShipFromLocation([
      { id: "sloc_a", phone: "", postal_code: "363035" },
      { id: "sloc_b", phone: "999", postal_code: "363035" },
    ])
    expect(picked?.id).toBe("sloc_b")
  })

  it("falls back to the first candidate when none is registered or registerable", () => {
    const picked = pickPartnerShipFromLocation([
      { id: "sloc_a" },
      { id: "sloc_b", phone: "999" }, // no pincode → not registerable
    ])
    expect(picked?.id).toBe("sloc_a")
  })

  it("treats whitespace-only phone/pincode as missing", () => {
    const picked = pickPartnerShipFromLocation([
      { id: "sloc_a", phone: "  ", postal_code: "363035" },
      { id: "sloc_b", phone: "999", postal_code: " 363035 " },
    ])
    expect(picked?.id).toBe("sloc_b")
  })
})
