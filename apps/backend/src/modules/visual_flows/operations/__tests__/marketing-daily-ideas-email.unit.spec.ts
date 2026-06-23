import {
  resolveSendEnabledOption,
  normalizeRecipientsOption,
  marketingDailyIdeasEmailOperation,
} from "../marketing-daily-ideas-email"

/**
 * #659 slice 2 — unit tests for the visual-flow operation's PURE option
 * coercers and its registration shape. The orchestration itself is covered in
 * workflows/marketing/__tests__/run-daily-ideas-email.unit.spec.ts (injected
 * stubs, no live LLM/email).
 */

describe("resolveSendEnabledOption", () => {
  it("returns undefined for unset/empty (caller falls back to env gate)", () => {
    expect(resolveSendEnabledOption(undefined)).toBeUndefined()
    expect(resolveSendEnabledOption(null)).toBeUndefined()
    expect(resolveSendEnabledOption("")).toBeUndefined()
  })
  it("passes through real booleans", () => {
    expect(resolveSendEnabledOption(true)).toBe(true)
    expect(resolveSendEnabledOption(false)).toBe(false)
  })
  it("coerces truthy/falsy strings", () => {
    expect(resolveSendEnabledOption("true")).toBe(true)
    expect(resolveSendEnabledOption("1")).toBe(true)
    expect(resolveSendEnabledOption("ON")).toBe(true)
    expect(resolveSendEnabledOption("false")).toBe(false)
    expect(resolveSendEnabledOption("0")).toBe(false)
    expect(resolveSendEnabledOption("no")).toBe(false)
  })
  it("returns undefined for unrecognized strings", () => {
    expect(resolveSendEnabledOption("maybe")).toBeUndefined()
  })
})

describe("normalizeRecipientsOption", () => {
  it("returns undefined when nothing usable", () => {
    expect(normalizeRecipientsOption(undefined)).toBeUndefined()
    expect(normalizeRecipientsOption([])).toBeUndefined()
    expect(normalizeRecipientsOption("")).toBeUndefined()
    expect(normalizeRecipientsOption("  , ")).toBeUndefined()
  })
  it("cleans an array", () => {
    expect(normalizeRecipientsOption([" a@x.com ", "", "b@x.com"])).toEqual([
      "a@x.com",
      "b@x.com",
    ])
  })
  it("splits a CSV string", () => {
    expect(normalizeRecipientsOption("a@x.com, b@x.com ")).toEqual([
      "a@x.com",
      "b@x.com",
    ])
  })
})

describe("marketingDailyIdeasEmailOperation registration", () => {
  it("has the expected type/category and a parseable schema", () => {
    expect(marketingDailyIdeasEmailOperation.type).toBe(
      "marketing_daily_ideas_email"
    )
    expect(marketingDailyIdeasEmailOperation.category).toBe("communication")
    // empty options parse cleanly (env gate decides send)
    expect(() =>
      marketingDailyIdeasEmailOperation.optionsSchema.parse({})
    ).not.toThrow()
    expect(() =>
      marketingDailyIdeasEmailOperation.optionsSchema.parse({
        send_enabled: true,
        recipients: ["a@x.com"],
      })
    ).not.toThrow()
  })
})
