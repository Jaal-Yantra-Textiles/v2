import { buildNextConfig, COST_CONFIG_FIELDS } from "../carry-forward"

/**
 * #1939 — the carry-forward rule.
 *
 * The failure this guards is quiet and expensive: a request that means "raise
 * the markup to 25%" blanking the platform fee, the overhead and the approval
 * markup because they were not mentioned.
 */

const current = {
  id: "pcc_initial",
  platform_fee_percent: 10,
  production_overhead_percent: 30,
  default_material_cost: 600,
  default_material_cost_currency: "INR",
  custom_design_markup_percent: 20,
  approval_markup_multiplier: 1.4,
}

describe("buildNextConfig", () => {
  it("🔴 a one-field change carries the other four forward", () => {
    const next = buildNextConfig({ custom_design_markup_percent: 25 }, current)
    expect(next.custom_design_markup_percent).toBe(25)
    // The whole point: none of these became null.
    expect(next.platform_fee_percent).toBe(10)
    expect(next.production_overhead_percent).toBe(30)
    expect(next.default_material_cost).toBe(600)
    expect(next.default_material_cost_currency).toBe("INR")
    expect(next.approval_markup_multiplier).toBe(1.4)
  })

  it("an EXPLICIT null unsets a field — distinct from omitting it", () => {
    const unset = buildNextConfig({ platform_fee_percent: null }, current)
    const omitted = buildNextConfig({}, current)
    expect(unset.platform_fee_percent).toBeNull()
    expect(omitted.platform_fee_percent).toBe(10)
  })

  it("carries a real 0 forward without mistaking it for absence", () => {
    // A 0 fee is a policy ("we take no commission") and must survive a later
    // unrelated edit. `?? null` on a 0 would be a bug; `??` only catches nullish.
    const zeroed = { ...current, platform_fee_percent: 0 }
    const next = buildNextConfig({ custom_design_markup_percent: 25 }, zeroed)
    expect(next.platform_fee_percent).toBe(0)
  })

  it("treats an explicitly-undefined key as ABSENT, not as unset", () => {
    // `{k: undefined}` and `{}` are indistinguishable after JSON round-trip, so
    // they must behave identically — which `!== undefined` would get wrong.
    const next = buildNextConfig({ platform_fee_percent: undefined }, current)
    expect(next.platform_fee_percent).toBe(10)
  })

  it("yields all-null when there is no policy to inherit from", () => {
    const next = buildNextConfig({}, null)
    for (const f of COST_CONFIG_FIELDS) {
      expect(next[f]).toBeNull()
    }
    // Never zeros — a zero would read as a decision nobody made.
    expect(Object.values(next)).not.toContain(0)
  })

  it("returns exactly the config columns, never stray body keys", () => {
    const next = buildNextConfig(
      { custom_design_markup_percent: 25, notes: "x", is_active: false, id: "evil" },
      current
    )
    expect(Object.keys(next).sort()).toEqual([...COST_CONFIG_FIELDS].sort())
  })
})
