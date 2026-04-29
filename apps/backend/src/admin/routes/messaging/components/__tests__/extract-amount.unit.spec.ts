import { extractSuggestedAmount } from "../extract-amount"

describe("extractSuggestedAmount", () => {
  it("returns undefined for empty / null / undefined", () => {
    expect(extractSuggestedAmount(undefined)).toBeUndefined()
    expect(extractSuggestedAmount(null)).toBeUndefined()
    expect(extractSuggestedAmount("")).toBeUndefined()
    expect(extractSuggestedAmount("   ")).toBeUndefined()
  })

  it("extracts plain large numbers", () => {
    expect(extractSuggestedAmount("1500")).toBe(1500)
    expect(extractSuggestedAmount("can you pay 1500")).toBe(1500)
    expect(extractSuggestedAmount("payment 12000 done")).toBe(12000)
  })

  it("handles comma grouping", () => {
    expect(extractSuggestedAmount("1,500")).toBe(1500)
    expect(extractSuggestedAmount("payment of 1,25,000 ok?")).toBe(125000)
    expect(extractSuggestedAmount("12,345.50")).toBe(12345.5)
  })

  it("recognizes rupee markers", () => {
    expect(extractSuggestedAmount("₹1500")).toBe(1500)
    expect(extractSuggestedAmount("₹ 1,500")).toBe(1500)
    expect(extractSuggestedAmount("INR 1500")).toBe(1500)
    expect(extractSuggestedAmount("Rs 1500")).toBe(1500)
    expect(extractSuggestedAmount("Rs. 1,500.50")).toBe(1500.5)
  })

  it("recognizes trailing currency", () => {
    expect(extractSuggestedAmount("1500 rupees")).toBe(1500)
    expect(extractSuggestedAmount("12000 rs for materials")).toBe(12000)
  })

  it("rejects ambiguous short numbers without a currency marker", () => {
    // "12 photos" should NOT pre-fill 12 — too noisy.
    expect(extractSuggestedAmount("ok 12 photos done")).toBeUndefined()
    expect(extractSuggestedAmount("done 5 of them")).toBeUndefined()
  })

  it("accepts short numbers when paired with a currency marker", () => {
    expect(extractSuggestedAmount("Rs 50")).toBe(50)
    expect(extractSuggestedAmount("₹99")).toBe(99)
  })

  it("rejects values outside sensible bounds", () => {
    // 0 and negatives — never sensible
    expect(extractSuggestedAmount("Rs 0")).toBeUndefined()
    // > 10M — almost certainly a phone number or order ID, not money
    expect(extractSuggestedAmount("100000000")).toBeUndefined()
  })

  it("handles a realistic message with mixed content", () => {
    expect(
      extractSuggestedAmount("hi sir, can you transfer ₹3,500 for last week's batch"),
    ).toBe(3500)
  })
})
