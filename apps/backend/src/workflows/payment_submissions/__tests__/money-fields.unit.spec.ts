import {
  foldMoneyFieldsIntoMetadata,
} from "../lib/money-fields"

/**
 * The money contract used to travel as untyped `metadata` keys, so the tests
 * that matter here are about PRECEDENCE and about not re-pricing a caller who
 * says nothing new. Both are money-visible: getting either wrong changes what a
 * partner is paid.
 */
describe("foldMoneyFieldsIntoMetadata", () => {
  it("leaves a metadata-only caller byte-for-byte unchanged", () => {
    // The partner form posts through metadata today. If this ever stops being
    // an identity, every live caller silently re-prices.
    const metadata = {
      design_quantities: { d1: 9 },
      design_unit_amounts: { d1: 850 },
      design_cost_overrides: { d2: 1200 },
      task_cost_overrides: { t1: 40 },
      unrelated: "kept",
    }

    expect(foldMoneyFieldsIntoMetadata({ metadata })).toEqual(metadata)
  })

  it("lets a typed field replace the matching metadata map outright", () => {
    const out = foldMoneyFieldsIntoMetadata({
      quantities: { d1: 4 },
      metadata: { design_quantities: { d1: 9, d2: 3 } },
    })

    // Not a per-key merge: `d2` must NOT survive from the stale blob, or a
    // caller that sent an explicit map could still be overridden per-key by
    // metadata it never wrote.
    expect(out.design_quantities).toEqual({ d1: 4 })
  })

  it("carries every typed field onto the channel the workflow reads", () => {
    // The workflow lifts these off metadata. A field accepted by the route but
    // not folded here would validate, look correct in the request, and silently
    // do nothing — the exact accepted-and-ignored defect this replaces.
    const out = foldMoneyFieldsIntoMetadata({
      quantities: { d1: 9 },
      unit_amounts: { d1: 850 },
      cost_overrides: { d2: 1200 },
      task_cost_overrides: { t1: 40 },
    })

    expect(out).toEqual({
      design_quantities: { d1: 9 },
      design_unit_amounts: { d1: 850 },
      design_cost_overrides: { d2: 1200 },
      task_cost_overrides: { t1: 40 },
    })
  })

  it("does not invent keys for fields the caller omitted", () => {
    const out = foldMoneyFieldsIntoMetadata({ quantities: { d1: 2 } })

    // An `undefined` under `design_unit_amounts` would be a present key to
    // `sanitizeCostOverrides`, and "absent" is what means "use the design's
    // stored cost". Presence and absence are different instructions.
    expect(Object.keys(out)).toEqual(["design_quantities"])
  })

  it("preserves unrelated metadata alongside a typed field", () => {
    const out = foldMoneyFieldsIntoMetadata({
      unit_amounts: { d1: 1150 },
      metadata: { created_by: "admin", source_production_run_id: "prod_run_1" },
    })

    expect(out.created_by).toBe("admin")
    expect(out.source_production_run_id).toBe("prod_run_1")
    expect(out.design_unit_amounts).toEqual({ d1: 1150 })
  })

  it("never folds production_run_ids onto the metadata channel", () => {
    // 🔴 The four money fields ride metadata because the partner form has
    // always posted them that way and must keep working. `production_run_ids`
    // has no such legacy caller, and it is the evidence the double-pay guard
    // reads — so it goes to the workflow as a TYPED input and must not appear
    // on the untyped blob at all. Folding it "for consistency" would put the
    // one field that decides whether someone is paid twice back into the
    // channel #1557 took the money out of.
    const out = foldMoneyFieldsIntoMetadata({
      quantities: { d1: 4 },
      production_run_ids: { d1: ["prod_run_1"] },
    } as any)

    expect(out.production_run_ids).toBeUndefined()
    expect(out.design_production_run_ids).toBeUndefined()
    expect(Object.keys(out)).toEqual(["design_quantities"])
  })
})
