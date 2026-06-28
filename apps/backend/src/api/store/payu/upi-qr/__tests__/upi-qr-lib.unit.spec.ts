import { buildUpiLink, isUpiLink, resolveUpiLink } from "../lib"

describe("isUpiLink", () => {
  it("accepts upi:// links (case-insensitive, trimmed)", () => {
    expect(isUpiLink("upi://pay?pa=x@hdfc")).toBe(true)
    expect(isUpiLink("  UPI://pay?pa=x ")).toBe(true)
  })
  it("rejects non-upi values", () => {
    expect(isUpiLink("https://pay")).toBe(false)
    expect(isUpiLink("")).toBe(false)
    expect(isUpiLink(123 as any)).toBe(false)
  })
})

describe("buildUpiLink", () => {
  it("builds from a vpa with amount, payee and note", () => {
    const link = buildUpiLink({ vpa: "merchant@hdfc", amount: 1299, payee_name: "JYT", note: "Order 1" })
    expect(link).toContain("upi://pay?")
    expect(link).toContain("pa=merchant%40hdfc")
    expect(link).toContain("am=1299.00")
    expect(link).toContain("cu=INR")
    expect(link).toContain("pn=JYT")
    expect(link).toContain("tn=Order+1")
  })
  it("omits a non-positive/invalid amount", () => {
    expect(buildUpiLink({ vpa: "x@y", amount: 0 })).not.toContain("am=")
    expect(buildUpiLink({ vpa: "x@y", amount: "nope" })).not.toContain("am=")
  })
  it("returns null without a vpa", () => {
    expect(buildUpiLink({ amount: 100 })).toBeNull()
  })
})

describe("resolveUpiLink", () => {
  it("prefers an explicit valid upi_link", () => {
    expect(resolveUpiLink({ upi_link: "upi://pay?pa=a@b", vpa: "x@y" })).toBe("upi://pay?pa=a@b")
  })
  it("builds from a vpa when no link given", () => {
    expect(resolveUpiLink({ vpa: "x@y", amount: 5 })).toContain("pa=x%40y")
  })
  it("returns null when neither is usable", () => {
    expect(resolveUpiLink({ upi_link: "not-a-upi-link" })).toBeNull()
    expect(resolveUpiLink({})).toBeNull()
  })
})
