import {
  effectiveAtMs,
  readCostConfig,
  readNumber,
  resolveCostConfig,
  type PlatformCostConfigRow,
} from "../resolve-lib"

/**
 * #1939 — the cost-config resolver.
 *
 * These tests are almost entirely about ABSENCE, because absence is what has
 * gone wrong here before: a `0` that meant "I found nothing" reached storefront
 * checkout. So the assertions that matter most are the ones distinguishing
 * `null` (nobody decided) from `0` (we decided it is free).
 */

const row = (o: Partial<PlatformCostConfigRow>): PlatformCostConfigRow => ({
  id: "pcc_x",
  effective_from: "2025-01-01T00:00:00Z",
  is_active: true,
  ...o,
})

describe("readNumber", () => {
  it("preserves a real zero — a zero fee is a policy, not an absence", () => {
    expect(readNumber(0)).toBe(0)
    expect(readNumber("0")).toBe(0)
  })

  it("returns null (never 0) for every flavour of unset", () => {
    // Number(null) === 0 and Number("") === 0; both must NOT survive as 0.
    expect(readNumber(null)).toBeNull()
    expect(readNumber(undefined)).toBeNull()
    expect(readNumber("")).toBeNull()
    expect(readNumber("   ")).toBeNull()
  })

  it("returns null for a corrupt value rather than NaN/Infinity", () => {
    expect(readNumber("abc")).toBeNull()
    expect(readNumber(NaN)).toBeNull()
    expect(readNumber(Infinity)).toBeNull()
  })

  it("reads a numeric string, as a DECIMAL column comes back", () => {
    expect(readNumber("1.4")).toBe(1.4)
    expect(readNumber("600")).toBe(600)
  })
})

describe("effectiveAtMs", () => {
  it("accepts a Date and an ISO string alike", () => {
    const iso = "2026-03-01T00:00:00Z"
    expect(effectiveAtMs(new Date(iso))).toBe(Date.parse(iso))
    expect(effectiveAtMs(iso)).toBe(Date.parse(iso))
  })

  it("returns null for a missing or unparseable date", () => {
    expect(effectiveAtMs(null)).toBeNull()
    expect(effectiveAtMs(undefined)).toBeNull()
    expect(effectiveAtMs("not a date")).toBeNull()
  })
})

describe("resolveCostConfig", () => {
  const at = new Date("2026-06-01T00:00:00Z")

  it("picks the LATEST policy effective at or before the moment", () => {
    const old = row({ id: "old", effective_from: "2025-01-01T00:00:00Z" })
    const current = row({ id: "current", effective_from: "2026-01-01T00:00:00Z" })
    expect(resolveCostConfig([old, current], at)?.id).toBe("current")
    // order of the input must not decide the answer
    expect(resolveCostConfig([current, old], at)?.id).toBe("current")
  })

  it("does NOT apply a future-dated row — staging is not taking effect", () => {
    const current = row({ id: "current", effective_from: "2026-01-01T00:00:00Z" })
    const staged = row({ id: "staged", effective_from: "2026-12-01T00:00:00Z" })
    expect(resolveCostConfig([current, staged], at)?.id).toBe("current")
  })

  it("skips an inactive row and falls back to the one it superseded", () => {
    const old = row({ id: "old", effective_from: "2025-01-01T00:00:00Z" })
    const revoked = row({
      id: "revoked",
      effective_from: "2026-01-01T00:00:00Z",
      is_active: false,
    })
    expect(resolveCostConfig([old, revoked], at)?.id).toBe("old")
  })

  it("skips a row with a broken or missing date instead of guessing one", () => {
    const broken = row({ id: "broken", effective_from: "nonsense" })
    const undated = row({ id: "undated", effective_from: null })
    expect(resolveCostConfig([broken, undated], at)).toBeNull()
  })

  it("returns null for no rows, empty rows, or nullish input", () => {
    expect(resolveCostConfig([], at)).toBeNull()
    expect(resolveCostConfig(null, at)).toBeNull()
    expect(resolveCostConfig(undefined, at)).toBeNull()
  })

  it("treats a row effective at exactly the moment as in force", () => {
    const exact = row({ id: "exact", effective_from: at.toISOString() })
    expect(resolveCostConfig([exact], at)?.id).toBe("exact")
  })
})

describe("readCostConfig", () => {
  it("🔴 returns NULLS, not zeros, when there is no policy at all", () => {
    const out = readCostConfig(null)
    // The bug this guards: a caller doing arithmetic on these would price at 0.
    expect(out.platform_fee_percent).toBeNull()
    expect(out.production_overhead_percent).toBeNull()
    expect(out.default_material_cost).toBeNull()
    expect(out.custom_design_markup_percent).toBeNull()
    expect(out.approval_markup_multiplier).toBeNull()
    expect(out.default_material_cost_currency).toBeNull()
    expect(out.source_config_id).toBeNull()
    expect(out.effective_from).toBeNull()
    // Stated explicitly, because `toBeFalsy` would pass on 0 and hide this.
    expect(Object.values(out)).not.toContain(0)
  })

  it("preserves a deliberate zero fee distinctly from an unset one", () => {
    const zeroed = readCostConfig(row({ platform_fee_percent: 0 }))
    const unset = readCostConfig(row({ platform_fee_percent: null }))
    expect(zeroed.platform_fee_percent).toBe(0)
    expect(unset.platform_fee_percent).toBeNull()
    // The two must not be conflated — this is the whole distinction.
    expect(zeroed.platform_fee_percent).not.toBe(unset.platform_fee_percent)
  })

  it("reads the seeded policy — today's compiled constants", () => {
    const out = readCostConfig(
      row({
        id: "pcc_initial",
        platform_fee_percent: 10,
        production_overhead_percent: 30,
        default_material_cost: "600",
        default_material_cost_currency: "INR",
        custom_design_markup_percent: 20,
        approval_markup_multiplier: 1.4,
      })
    )
    expect(out.platform_fee_percent).toBe(10)
    expect(out.production_overhead_percent).toBe(30)
    expect(out.default_material_cost).toBe(600)
    expect(out.default_material_cost_currency).toBe("INR")
    expect(out.custom_design_markup_percent).toBe(20)
    expect(out.approval_markup_multiplier).toBe(1.4)
  })

  it("returns the source id and date so a price can record what it used", () => {
    const out = readCostConfig(
      row({ id: "pcc_initial", effective_from: "2025-01-01T00:00:00Z" })
    )
    expect(out.source_config_id).toBe("pcc_initial")
    expect(out.effective_from?.toISOString()).toBe("2025-01-01T00:00:00.000Z")
  })

  it("keeps the two markups separate — they differ in shape AND value", () => {
    const out = readCostConfig(
      row({ custom_design_markup_percent: 20, approval_markup_multiplier: 1.4 })
    )
    // 20 is a PERCENT, 1.4 is a MULTIPLIER. Conflating them misprices by ~17%.
    expect(out.custom_design_markup_percent).toBe(20)
    expect(out.approval_markup_multiplier).toBe(1.4)
    expect(out.custom_design_markup_percent).not.toBe(
      out.approval_markup_multiplier
    )
  })
})
