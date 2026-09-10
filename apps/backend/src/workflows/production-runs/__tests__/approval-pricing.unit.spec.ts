/**
 * The money rule for an approved run's product (#1914).
 *
 * Approval listed at `design.estimated_cost ?? 0`: it never read what the run
 * actually cost, it listed at ZERO when the estimate was missing (#1900 caught
 * that reaching the storefront), and it applied no margin at all — the listed
 * price WAS the cost.
 *
 * These pin all three, and the two coercion traps that make the zero case so
 * easy to reintroduce.
 */
import {
  APPROVAL_FALLBACK_CURRENCY,
  APPROVAL_MARKUP,
  resolveApprovalCurrency,
  approvalCurrencyWasAssumed,
  resolveApprovalPrice,
} from "../approval-pricing"

describe("resolveApprovalPrice", () => {
  it("prices from the RUN's actual cost per unit, not the design estimate", () => {
    // The whole point: a design estimate typed months ago does not decide what
    // the work cost. When both exist, the run wins.
    const out = resolveApprovalPrice({
      runCostPerUnit: 165,
      designEstimatedCost: 999,
    })
    expect(out).toEqual({ price: 231, cost: 165, source: "run_cost" })
  })

  it("applies the agreed markup, with the founder's worked examples", () => {
    expect(resolveApprovalPrice({ runCostPerUnit: 165 })?.price).toBe(231)
    expect(resolveApprovalPrice({ runCostPerUnit: 690 })?.price).toBe(966)
    expect(resolveApprovalPrice({ runCostPerUnit: 1460 })?.price).toBe(2044)
    expect(APPROVAL_MARKUP).toBe(1.4)
  })

  it("falls back to the design estimate when the run was never costed", () => {
    // cost_per_unit is null when a run has no consumption logs. The estimate is
    // a worse answer than the run's real cost and a far better one than none.
    const out = resolveApprovalPrice({
      runCostPerUnit: null,
      designEstimatedCost: 200,
    })
    expect(out).toEqual({ price: 280, cost: 200, source: "design_estimate" })
  })

  it("REFUSES when there is no cost anywhere — never lists at zero", () => {
    // A price of 0 is a claim, not a blank. #1900 caught one on the storefront.
    expect(resolveApprovalPrice({})).toBeNull()
    expect(
      resolveApprovalPrice({ runCostPerUnit: null, designEstimatedCost: null })
    ).toBeNull()
  })

  it("treats 0 as ABSENT on both inputs, not as free goods", () => {
    /*
     * The trap that makes the zero case easy to reintroduce: `Number(null)` is
     * `0`, so a `!= null` guard passes a missing figure through as a real one.
     * A run whose logs sum to 0 has not been costed; it did not cost nothing.
     */
    expect(resolveApprovalPrice({ runCostPerUnit: 0 })).toBeNull()
    expect(resolveApprovalPrice({ designEstimatedCost: 0 })).toBeNull()
    expect(
      resolveApprovalPrice({ runCostPerUnit: 0, designEstimatedCost: 150 })
    ).toEqual({ price: 210, cost: 150, source: "design_estimate" })
  })

  it("rejects figures that are not real numbers rather than emitting NaN", () => {
    // A NaN price would be written to the price row and read back as a broken
    // product, which is harder to notice than a refusal.
    expect(resolveApprovalPrice({ runCostPerUnit: NaN })).toBeNull()
    expect(
      resolveApprovalPrice({ runCostPerUnit: undefined, designEstimatedCost: -5 })
    ).toBeNull()
    expect(resolveApprovalPrice({ runCostPerUnit: Infinity })).toBeNull()
  })

  it("rounds to 2dp in MAJOR units, without float drift", () => {
    // Medusa 2.x prices are decimal major units — this codebase had exactly one
    // place that multiplied by 100 (a v1 habit) and it over-priced 100x.
    expect(resolveApprovalPrice({ runCostPerUnit: 10.1 })?.price).toBe(14.14)
    expect(resolveApprovalPrice({ runCostPerUnit: 0.07 })?.price).toBe(0.1)
    // 1.005 * 1.4 = 1.407 -> 1.41, and must not land on 1.4 via binary drift.
    expect(resolveApprovalPrice({ runCostPerUnit: 1.005 })?.price).toBe(1.41)
  })

  it("reports which cost the price came from", () => {
    // Recorded rather than inferred: a price that cannot say where it came from
    // is the shape of the `metadata` problems this codebase keeps hitting.
    expect(resolveApprovalPrice({ runCostPerUnit: 10 })?.source).toBe("run_cost")
    expect(resolveApprovalPrice({ designEstimatedCost: 10 })?.source).toBe(
      "design_estimate"
    )
  })

  it("honours an explicit markup override without changing the default", () => {
    expect(resolveApprovalPrice({ runCostPerUnit: 100, markup: 1 })?.price).toBe(100)
    expect(resolveApprovalPrice({ runCostPerUnit: 100 })?.price).toBe(140)
  })
})

describe("resolveApprovalCurrency", () => {
  it("prefers the design's own cost_currency", () => {
    expect(resolveApprovalCurrency({ designCurrency: "AUD" })).toBe("aud")
  })

  /**
   * #1979 — the RUN answers first. `resolveApprovalPrice` already prefers the
   * run's actual cost over the design's estimate, so the denomination has to
   * follow the same record; otherwise a price is valued by one and labelled by
   * the other.
   */
  it("prefers the RUN's currency over the design's", () => {
    expect(
      resolveApprovalCurrency({ runCurrency: "usd", designCurrency: "inr" })
    ).toBe("usd")
    expect(resolveApprovalCurrency({ runCurrency: "  USD " })).toBe("usd")
  })

  it("falls through to the design when the run states nothing", () => {
    expect(
      resolveApprovalCurrency({ runCurrency: null, designCurrency: "aud" })
    ).toBe("aud")
    expect(
      resolveApprovalCurrency({ runCurrency: "", designCurrency: "aud" })
    ).toBe("aud")
    // whitespace is not a statement either
    expect(
      resolveApprovalCurrency({ runCurrency: "   ", designCurrency: "aud" })
    ).toBe("aud")
  })

  it("still lands on INR when neither states one", () => {
    expect(
      resolveApprovalCurrency({ runCurrency: null, designCurrency: null })
    ).toBe("inr")
  })

  /**
   * 🔴 #1979 — THE REGRESSION. The chain was
   * `designCurrency || storeCurrency || "inr"`, and JYT Medu Store's default is
   * EUR, so the INR last resort was unreachable on the only store we sell from.
   * A jacket costed at ₹2,634.75 minted as €2,634.75 and fanned out to
   * ₹291,560 — about 110× its cost.
   *
   * The store is no longer asked, so it cannot be passed: this reads
   * `designCurrency` alone, and an absent one lands on INR however the store is
   * configured.
   */
  it("does not inherit a EUR store default for a design costed in INR", () => {
    expect(resolveApprovalCurrency({ designCurrency: null })).toBe("inr")
    expect(resolveApprovalCurrency({ designCurrency: undefined })).toBe("inr")
    expect(resolveApprovalCurrency({ designCurrency: null })).not.toBe("eur")
  })

  it("refuses a store default even if one is smuggled in", () => {
    /*
     * `storeCurrency` is gone from the input TYPE, which is the real guard —
     * this proves the runtime ignores it too, so a stale JS caller (or a cast)
     * cannot resurrect the 110x bug silently.
     */
    expect(
      resolveApprovalCurrency({ designCurrency: null, storeCurrency: "eur" } as any)
    ).toBe("inr")
    expect(
      resolveApprovalCurrency({ designCurrency: "inr", storeCurrency: "eur" } as any)
    ).toBe("inr")
  })

  it("lands on INR, not usd, when nothing states a currency", () => {
    /*
     * The route once hardcoded "usd" on a platform trading in AUD and INR, and
     * "usd" survived the fix as the last resort — still mis-pricing any design
     * that never recorded a currency. Production is costed in INR.
     */
    expect(resolveApprovalCurrency({})).toBe("inr")
    expect(APPROVAL_FALLBACK_CURRENCY).toBe("inr")
    expect(resolveApprovalCurrency({})).not.toBe("usd")
  })

  it("normalises case and stray whitespace", () => {
    expect(resolveApprovalCurrency({ designCurrency: "  INR " })).toBe("inr")
  })

  it("treats an empty string as unstated", () => {
    // '' is falsy but is not null — the same shape that defeated an
    // `is not null` CHECK constraint elsewhere in this codebase.
    expect(resolveApprovalCurrency({ designCurrency: "" })).toBe("inr")
    expect(resolveApprovalCurrency({ designCurrency: "   " })).toBe("inr")
  })
})

describe("approvalCurrencyWasAssumed", () => {
  it("is true exactly when NEITHER the run nor the design stated one", () => {
    expect(approvalCurrencyWasAssumed(null)).toBe(true)
    expect(approvalCurrencyWasAssumed(undefined)).toBe(true)
    expect(approvalCurrencyWasAssumed("")).toBe(true)
    // whitespace is not a statement — tested RAW, before any coercion
    expect(approvalCurrencyWasAssumed("   ")).toBe(true)
    expect(approvalCurrencyWasAssumed(null, null)).toBe(true)
    expect(approvalCurrencyWasAssumed("", "  ")).toBe(true)
  })

  it("is false when EITHER states one", () => {
    expect(approvalCurrencyWasAssumed("inr")).toBe(false)
    expect(approvalCurrencyWasAssumed("EUR")).toBe(false)
    // 🔴 the run alone is enough — nothing was assumed if the run said it
    expect(approvalCurrencyWasAssumed(null, "usd")).toBe(false)
    expect(approvalCurrencyWasAssumed("", "usd")).toBe(false)
  })
})
