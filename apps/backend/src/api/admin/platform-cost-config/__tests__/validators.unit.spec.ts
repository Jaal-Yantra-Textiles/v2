import { CreatePlatformCostConfigSchema as S } from "../validators"

const ok = (b: unknown) => S.safeParse(b).success

/**
 * #1939 — the payload guards.
 *
 * The interesting case is the percent/multiplier confusion. `custom_design_
 * markup_percent` takes 20 to mean +20%; `approval_markup_multiplier` takes 1.4
 * to mean 140% of cost. Typing 40 into the multiplier means 4000%, and a live
 * probe caught exactly that sailing through an earlier, looser ceiling.
 */
describe("CreatePlatformCostConfigSchema", () => {
  it("accepts a single-field change — the carry-forward case", () => {
    expect(ok({ custom_design_markup_percent: 25 })).toBe(true)
    expect(ok({})).toBe(true)
  })

  it("accepts an explicit null (the deliberate 'unset')", () => {
    expect(ok({ platform_fee_percent: null })).toBe(true)
  })

  it("accepts 0 — a zero commission is a real policy", () => {
    expect(ok({ platform_fee_percent: 0 })).toBe(true)
  })

  it("rejects a negative percent", () => {
    expect(ok({ platform_fee_percent: -5 })).toBe(false)
  })

  it("🔴 rejects a PERCENT typed into the MULTIPLIER field", () => {
    // The live defect: 40 passed a max of 100 and would list at 4000% of cost.
    expect(ok({ approval_markup_multiplier: 40 })).toBe(false)
    expect(ok({ approval_markup_multiplier: 20 })).toBe(false)
    expect(ok({ approval_markup_multiplier: 25 })).toBe(false)
  })

  it("still accepts real multipliers, including today's 1.4", () => {
    expect(ok({ approval_markup_multiplier: 1.4 })).toBe(true)
    expect(ok({ approval_markup_multiplier: 1 })).toBe(true)
    expect(ok({ approval_markup_multiplier: 2.5 })).toBe(true)
  })

  it("rejects a multiplier below 1 — it would list BELOW cost", () => {
    expect(ok({ approval_markup_multiplier: 0.9 })).toBe(false)
  })

  it("rejects a malformed currency and a malformed date", () => {
    expect(ok({ default_material_cost_currency: "RUPEES" })).toBe(false)
    expect(ok({ default_material_cost_currency: "INR" })).toBe(true)
    expect(ok({ effective_from: "not a date" })).toBe(false)
    expect(ok({ effective_from: "2026-10-01T00:00:00Z" })).toBe(true)
  })

  it("rejects a negative material cost", () => {
    expect(ok({ default_material_cost: -1 })).toBe(false)
    expect(ok({ default_material_cost: 600 })).toBe(true)
  })
})
