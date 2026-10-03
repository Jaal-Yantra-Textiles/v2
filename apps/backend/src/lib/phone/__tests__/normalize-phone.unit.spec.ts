import { normalizePhoneE164 } from "../normalize-phone"

describe("normalizePhoneE164", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+1 (415) 555-2671", "+14155552671"],
    ["+919876543210", "+919876543210"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizePhoneE164(raw)).toBe(expected)
  })

  it("keeps a short test number libphonenumber refuses", () => {
    expect(normalizePhoneE164("+91 00000000")).toBe("+9100000000")
  })

  it.each([null, undefined, "", "   ", "not a number"])("%p → null", (raw) => {
    expect(normalizePhoneE164(raw as any)).toBeNull()
  })
})
