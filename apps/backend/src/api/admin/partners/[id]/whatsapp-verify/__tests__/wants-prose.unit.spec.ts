import { wantsProse } from "../route"

/**
 * The MCP dispatcher sends booleans as STRINGS. A preview of
 * `connect_partner_whatsapp(use_prose: true)` shows the body it will POST as
 * `{"use_prose": "true"}`, so a strict `=== true` is false for every call that
 * arrives through the agent surface — and the send silently falls back to the
 * fixed welcome template while reporting success.
 */
describe("wantsProse", () => {
  it("accepts a real boolean", () => {
    expect(wantsProse(true)).toBe(true)
  })

  it("accepts the STRING the MCP dispatcher actually sends", () => {
    expect(wantsProse("true")).toBe(true)
    expect(wantsProse("TRUE")).toBe(true)
    expect(wantsProse(" true ")).toBe(true)
  })

  it("accepts the other affirmative spellings", () => {
    expect(wantsProse("1")).toBe(true)
    expect(wantsProse("yes")).toBe(true)
    expect(wantsProse("on")).toBe(true)
  })

  it('🔴 does NOT treat "false" as true', () => {
    // A non-empty string is truthy, so plain truthiness would make an opt-in
    // impossible to opt out of — the flag would be stuck on for any caller who
    // spelled it out.
    expect(wantsProse("false")).toBe(false)
    expect(wantsProse("0")).toBe(false)
    expect(wantsProse("no")).toBe(false)
    expect(wantsProse("off")).toBe(false)
  })

  it("is false for absent, null and nonsense", () => {
    expect(wantsProse(undefined)).toBe(false)
    expect(wantsProse(null)).toBe(false)
    expect(wantsProse("")).toBe(false)
    expect(wantsProse(1)).toBe(false)
    expect(wantsProse({})).toBe(false)
  })
})
