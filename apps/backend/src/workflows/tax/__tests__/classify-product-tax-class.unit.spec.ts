import {
  isFabricHsCode,
  shouldAssignOver2500,
} from "../classify-product-tax-class"

describe("GST over-₹2,500 class", () => {
  it("🔴 does NOT fire at exactly ₹2,500 — 5% applies up to and including it", () => {
    expect(shouldAssignOver2500(2500, null)).toBe(false)
    expect(shouldAssignOver2500(2501, null)).toBe(true)
  })

  it("never fires with no INR price", () => {
    expect(shouldAssignOver2500(null, null)).toBe(false)
  })

  it("🔴 never fires for fabric (HS chapters 50–60), whatever the pack costs", () => {
    // A 12 m pack of kala cotton at ₹3,600 put every variant at 18%.
    expect(shouldAssignOver2500(3600, "5208")).toBe(false)
    expect(shouldAssignOver2500(24000, "5208.39")).toBe(false)
  })

  it("still fires for garments and made-ups over ₹2,500", () => {
    expect(shouldAssignOver2500(6000, "6205")).toBe(true)
    expect(shouldAssignOver2500(8000, "6304")).toBe(true)
  })
})

describe("isFabricHsCode", () => {
  it.each([
    ["5208", true],
    ["5209.42", true],
    ["50", true],
    ["6011", true],
    ["4911", false],
    ["6101", false],
    ["", false],
    [null, false],
  ])("%s → %s", (code, expected) => {
    expect(isFabricHsCode(code as any)).toBe(expected)
  })
})
