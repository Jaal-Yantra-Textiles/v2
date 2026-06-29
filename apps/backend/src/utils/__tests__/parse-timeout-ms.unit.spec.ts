import { parseTimeoutMs } from "../parse-timeout-ms"

describe("parseTimeoutMs", () => {
  const FALLBACK = 60000

  it("returns the fallback for undefined/null/empty", () => {
    expect(parseTimeoutMs(undefined, FALLBACK)).toBe(FALLBACK)
    expect(parseTimeoutMs(null, FALLBACK)).toBe(FALLBACK)
    expect(parseTimeoutMs("", FALLBACK)).toBe(FALLBACK)
    expect(parseTimeoutMs("   ", FALLBACK)).toBe(FALLBACK)
  })

  it("parses a valid positive integer", () => {
    expect(parseTimeoutMs("30000", FALLBACK)).toBe(30000)
    expect(parseTimeoutMs("  45000  ", FALLBACK)).toBe(45000)
  })

  it("floors fractional values to whole ms", () => {
    expect(parseTimeoutMs("1500.9", FALLBACK)).toBe(1500)
  })

  it("rejects NaN / non-numeric and falls back", () => {
    expect(parseTimeoutMs("garbage", FALLBACK)).toBe(FALLBACK)
    expect(parseTimeoutMs("10s", FALLBACK)).toBe(FALLBACK)
  })

  it("rejects zero and negative values (would fire immediately)", () => {
    expect(parseTimeoutMs("0", FALLBACK)).toBe(FALLBACK)
    expect(parseTimeoutMs("-5", FALLBACK)).toBe(FALLBACK)
  })

  it("rejects non-finite values", () => {
    expect(parseTimeoutMs("Infinity", FALLBACK)).toBe(FALLBACK)
  })
})
