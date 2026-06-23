/**
 * Unit test — ideas-email hallucination guard (#659 slice 2, spec 02 §3/§8).
 * Pure number-parsing + tolerance + fail-closed logic. No DI, no DB, no LLM.
 *
 * Run:
 *   TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="ideas-email-guard"
 */
import {
  parseNumberToken,
  extractNumericTokens,
  substitutePlaceholders,
  validateStrayNumbers,
  runGuard,
  type GroundTruth,
} from "../ideas-email-guard-lib"

const GT: GroundTruth = {
  date_ist: "2026-06-23",
  one_goal: "Grow GMV",
  values: [
    { token: "TODAY_GMV", value: 184320.5, display: "₹1,84,320", unit: "INR" },
    { token: "DELTA_DOD", value: 12.5, display: "+12.5%", unit: "percent" },
    { token: "ORDERS", value: 42, display: "42", unit: "count" },
    { token: "ZERO_METRIC", value: 0, display: "0", unit: "count" },
  ],
}

describe("parseNumberToken", () => {
  it("parses Indian comma grouping", () => {
    expect(parseNumberToken("1,84,320")).toBe(184320)
  })
  it("parses percentage to its numeric value", () => {
    expect(parseNumberToken("12.5%")).toBe(12.5)
  })
  it("expands ₹4.5L to 450000 (lakh)", () => {
    expect(parseNumberToken("₹4.5L")).toBe(450000)
  })
  it("expands $1.2M to 1200000", () => {
    expect(parseNumberToken("$1.2M")).toBe(1200000)
  })
  it("expands crore", () => {
    expect(parseNumberToken("2Cr")).toBe(20000000)
    expect(parseNumberToken("1.5 crore")).toBe(15000000)
  })
  it("expands K", () => {
    expect(parseNumberToken("5K")).toBe(5000)
  })
  it("handles negatives and decimals", () => {
    expect(parseNumberToken("-3")).toBe(-3)
    expect(parseNumberToken("0.42")).toBe(0.42)
  })
  it("returns null for non-numbers", () => {
    expect(parseNumberToken("abc")).toBeNull()
    expect(parseNumberToken("")).toBeNull()
    expect(parseNumberToken(null as any)).toBeNull()
  })
})

describe("extractNumericTokens", () => {
  it("extracts each number-shaped literal with canonical value", () => {
    const toks = extractNumericTokens("GMV ₹1,84,320 up 12.5% over 42 orders")
    const vals = toks.map((t) => t.value)
    expect(vals).toEqual([184320, 12.5, 42])
  })
  it("returns [] for text with no numbers", () => {
    expect(extractNumericTokens("no digits here")).toEqual([])
    expect(extractNumericTokens("")).toEqual([])
  })
  it("does not parse a single letter following a space as a suffix", () => {
    // "5 Killer ideas" must be 5, not 5000
    const toks = extractNumericTokens("5 Killer ideas")
    expect(toks[0].value).toBe(5)
  })
})

describe("substitutePlaceholders", () => {
  it("replaces known tokens with their display value", () => {
    const r = substitutePlaceholders(
      "GMV is {TODAY_GMV}, change {DELTA_DOD}.",
      GT
    )
    expect(r.text).toBe("GMV is ₹1,84,320, change +12.5%.")
    expect(r.substituted.sort()).toEqual(["DELTA_DOD", "TODAY_GMV"])
    expect(r.missing).toEqual([])
  })
  it("reports unknown placeholders as missing and leaves them intact (fail-closed)", () => {
    const r = substitutePlaceholders("invented {MADE_UP_TOKEN} here", GT)
    expect(r.missing).toEqual(["MADE_UP_TOKEN"])
    expect(r.text).toContain("{MADE_UP_TOKEN}")
  })
})

describe("validateStrayNumbers", () => {
  it("passes a literal within ±2% of a ground-truth value", () => {
    // 184320 is within 2% of 184320.5
    const r = validateStrayNumbers("we hit 184320 today", GT)
    expect(r.passed).toBe(true)
    expect(r.failures).toEqual([])
  })
  it("fails an out-of-tolerance literal with correct deviationPct", () => {
    const r = validateStrayNumbers("we hit 999999 today", GT)
    expect(r.passed).toBe(false)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].value).toBe(999999)
    expect(r.failures[0].nearest).toBe(184320.5)
    expect(r.failures[0].deviationPct).toBeGreaterThan(2)
  })
  it("whitelists the business-day year", () => {
    const r = validateStrayNumbers("plan for 2026 holidays", GT)
    expect(r.passed).toBe(true)
  })
  it("whitelists small list-marker ordinals (1. 2) etc)", () => {
    const r = validateStrayNumbers("1. do this\n2) do that", GT)
    expect(r.passed).toBe(true)
  })
  it("honours a caller allow-list of exact raw literals", () => {
    const r = validateStrayNumbers("target a 20% lift", GT, 2, ["20%"])
    expect(r.passed).toBe(true)
  })
  it("does not divide-by-zero against an exact-0 ground truth", () => {
    const r = validateStrayNumbers("we had 0 refunds", GT)
    expect(r.passed).toBe(true)
    // a non-zero stray near zero is still out of tolerance, not NaN
    const r2 = validateStrayNumbers("we had 7 refunds", GT)
    const zeroFail = r2.failures.find((f) => f.nearest === 0)
    if (zeroFail) expect(zeroFail.deviationPct).not.toBeNaN()
  })
})

describe("runGuard", () => {
  it("passes clean placeholder-only text and applies substitution", () => {
    const raw = "1. Push {TODAY_GMV} GMV.\n2. DoD is {DELTA_DOD}."
    const v = runGuard(raw, GT)
    expect(v.passed).toBe(true)
    expect(v.finalText).toContain("₹1,84,320")
    expect(v.finalText).toContain("+12.5%")
    expect(v.substituted.sort()).toEqual(["DELTA_DOD", "TODAY_GMV"])
    expect(v.failures).toEqual([])
  })
  it("fails closed on a stray hallucinated number", () => {
    const raw = "Revenue jumped to ₹5,00,000 today, push harder."
    const v = runGuard(raw, GT)
    expect(v.passed).toBe(false)
    expect(v.failures.some((f) => f.type === "stray_number")).toBe(true)
  })
  it("fails closed on a missing/invented placeholder", () => {
    const raw = "Our {INVENTED_METRIC} is great."
    const v = runGuard(raw, GT)
    expect(v.passed).toBe(false)
    expect(v.failures.some((f) => f.type === "missing_placeholder")).toBe(true)
  })
  it("does not flag placeholder-derived numbers as stray after substitution", () => {
    // {TODAY_GMV} → ₹1,84,320 — the 184320 in finalText must not trip Layer B
    const v = runGuard("GMV {TODAY_GMV} now.", GT)
    expect(v.passed).toBe(true)
  })
  it("respects a custom tolerance", () => {
    // 190000 is ~3.1% off 184320.5; passes at 5% tolerance, fails at default 2%
    expect(runGuard("hit 190000", GT, { tolerancePct: 5 }).passed).toBe(true)
    expect(runGuard("hit 190000", GT).passed).toBe(false)
  })
})
