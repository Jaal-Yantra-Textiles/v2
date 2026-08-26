import { nearMissMoneyKey } from "../lib/money-fields"

/**
 * The #1554-by-typo defence (#1571).
 *
 * 🔴 Typed fields protect a caller that uses them. They do nothing for one that
 * posts `metadata.design_quantites`: that key validates cleanly against
 * `z.record(z.string(), z.any())`, is read by nothing, and the line falls
 * through to "absent means 1" — a per-unit rate billed once. There is no bad
 * VALUE for a sanitizer to reject, only a fact that never arrived, so the
 * boundary is the only place it is visible.
 */
describe("nearMissMoneyKey", () => {
  it("catches the exact typo that motivated the typed fields", () => {
    // One edit from `design_quantities`. This spelling billed ₹850 for nine
    // garments and was invisible to tsc, to every test, and to the reviewer.
    expect(nearMissMoneyKey({ design_quantites: { d1: 9 } })).toEqual({
      key: "design_quantites",
      meant: "design_quantities",
    })
  })

  it("catches near-misses of each money key", () => {
    const cases: Array<[string, string]> = [
      ["design_cost_override", "design_cost_overrides"],
      ["task_cost_override", "task_cost_overrides"],
      ["design_unit_amount", "design_unit_amounts"],
      ["design_quantity", "design_quantities"],
    ]
    for (const [typo, meant] of cases) {
      expect(nearMissMoneyKey({ [typo]: {} })).toEqual({ key: typo, meant })
    }
  })

  it("is case-insensitive", () => {
    expect(nearMissMoneyKey({ Design_Quantities: {} })?.meant).toBe(
      "design_quantities"
    )
  })

  it("allows the canonical keys — that channel is still honoured", () => {
    // 🔴 The legacy read is deliberately kept: dropping it would silently stop
    // honouring callers still posting that way, re-pricing their lines off the
    // design's stored cost. A money change nobody asked for is worse than the
    // channel being untyped.
    expect(
      nearMissMoneyKey({
        design_cost_overrides: { d1: 100 },
        task_cost_overrides: { t1: 100 },
        design_quantities: { d1: 9 },
        design_unit_amounts: { d1: 850 },
      })
    ).toBeNull()
  })

  it("does not fire on ordinary metadata", () => {
    // The guard must not become a reason to avoid `metadata` altogether — it is
    // a legitimate free-form channel for everything that is not money.
    expect(
      nearMissMoneyKey({
        created_by: "admin",
        notes: "hello",
        source: "production_run.completed",
        auto_drafted: true,
        quantity_basis: "produced",
        source_production_run_id: "prod_run_1",
        production_run_id: "prod_run_1",
        payable_amount: 7650,
        ordered_quantity: 9,
        partner_cost_estimate: 850,
        cost_type: "per_unit",
      })
    ).toBeNull()
  })

  it("handles no metadata at all", () => {
    expect(nearMissMoneyKey(null)).toBeNull()
    expect(nearMissMoneyKey(undefined)).toBeNull()
    expect(nearMissMoneyKey({})).toBeNull()
  })
})
