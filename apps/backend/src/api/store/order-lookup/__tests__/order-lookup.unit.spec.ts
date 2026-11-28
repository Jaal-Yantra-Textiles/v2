import { lookupAllowed, parseOrderNumber } from "../route"

describe("order lookup", () => {
  it("reads the order number the way buyers type it", () => {
    expect(parseOrderNumber("#331")).toBe(331)
    expect(parseOrderNumber(" 331 ")).toBe(331)
    expect(parseOrderNumber("331abc")).toBeNull()
    expect(parseOrderNumber("")).toBeNull()
    expect(parseOrderNumber("order_01M8")).toBeNull()
  })
  it("allows 10 tries per IP per 10 minutes, then refuses until the window passes", () => {
    const t0 = 1_000_000
    for (let i = 0; i < 10; i++) expect(lookupAllowed("1.2.3.4", t0 + i)).toBe(true)
    expect(lookupAllowed("1.2.3.4", t0 + 11)).toBe(false)
    expect(lookupAllowed("5.6.7.8", t0 + 11)).toBe(true)
    expect(lookupAllowed("1.2.3.4", t0 + 10 * 60 * 1000 + 1)).toBe(true)
  })
})
