import { pickSellerLocation } from "../gather-order-tax-invoice"

describe("pickSellerLocation (#2532)", () => {
  const dharamshala = { id: "sloc_dsh", name: "Dharamshala" }
  const delhi = { id: "sloc_del", name: "Delhi" }

  it("uses the channel's only location", () => {
    expect(pickSellerLocation([dharamshala], null)).toEqual({ location: dharamshala })
  })

  it("prefers the store default when the channel has several", () => {
    expect(pickSellerLocation([delhi, dharamshala], "sloc_dsh")).toEqual({ location: dharamshala })
  })

  it("refuses to guess between several without a matching default", () => {
    const r = pickSellerLocation([delhi, dharamshala, null], "sloc_other")
    expect("error" in r && r.error).toContain("Delhi, Dharamshala")
  })

  it("refuses a channel with no location", () => {
    expect("error" in pickSellerLocation([], "sloc_dsh")).toBe(true)
  })
})
