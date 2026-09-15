import {
  appendOptionValuePayload,
  designOptionValue,
  designProductNaming,
  resolveDesignSizeLabel,
  resolveRunsSizeLabel,
  resolveListedPrice,
} from "../create-product-from-design"

/**
 * The price a design is listed at. Medusa 2.x amounts are DECIMAL major units —
 * the seed lists a €10 shirt as `amount: 10` through the same
 * `createProductsWorkflow` this workflow calls.
 */
describe("resolveListedPrice", () => {
  it("lists estimated_cost verbatim — NOT multiplied by 100", () => {
    // The defect: `Math.round(estimated_cost * 100)` listed a ₹850 design at
    // 85,000. This is the whole test.
    expect(resolveListedPrice({ estimated_cost: 850 })).toBe(850)
  })

  it("keeps the decimal part instead of rounding it away", () => {
    // The old code's Math.round applied AFTER the ×100, so 12.34 became 1234.
    // Verbatim, the paise survive.
    expect(resolveListedPrice({ estimated_cost: 12.34 })).toBe(12.34)
  })

  it("prefers unit_price when the quote path supplies one", () => {
    expect(
      resolveListedPrice({ estimated_cost: 850, unit_price: 999 })
    ).toBe(999)
  })

  it("treats the two inputs identically now the multiply is gone", () => {
    expect(resolveListedPrice({ estimated_cost: 850 })).toBe(
      resolveListedPrice({ estimated_cost: 0, unit_price: 850 })
    )
  })

  it("falls through to estimated_cost when unit_price is null or absent", () => {
    expect(resolveListedPrice({ estimated_cost: 40, unit_price: null })).toBe(40)
    expect(resolveListedPrice({ estimated_cost: 40 })).toBe(40)
  })

  it("takes an explicit unit_price of 0 at its word", () => {
    // `!= null`, not truthiness: a deliberate 0 is not "unspecified".
    expect(resolveListedPrice({ estimated_cost: 850, unit_price: 0 })).toBe(0)
  })

  it("floors nonsense at 0 rather than writing it into a price row", () => {
    // The approve route passes `design.estimated_cost || 0`, but the quote path
    // passes whatever the estimator produced.
    expect(resolveListedPrice({ estimated_cost: NaN })).toBe(0)
    expect(resolveListedPrice({ estimated_cost: -5 })).toBe(0)
    expect(
      resolveListedPrice({ estimated_cost: 10, unit_price: Number("nope") })
    ).toBe(0)
  })
})

describe("designOptionValue — #1874", () => {
  it("claims the design's own name, so two designs on one product differ", () => {
    const a = designOptionValue({ id: "des_a", name: "Kalamkari Stole" }, ["Custom"])
    const b = designOptionValue({ id: "des_b", name: "Ajrakh Stole" }, ["Custom", a])
    expect(a).toBe("Kalamkari Stole")
    expect(b).toBe("Ajrakh Stole")
    // The whole point: the tuple Medusa resolves a variant by is now distinct.
    expect(a).not.toBe(b)
  })

  it("never returns a value the product already carries", () => {
    // Two designs sharing a name would otherwise collide exactly as "Custom" did.
    const first = designOptionValue({ id: "des_aaa111", name: "Stole" }, [])
    const second = designOptionValue({ id: "des_bbb222", name: "Stole" }, [first])
    expect(first).toBe("Stole")
    expect(second).toBe("Stole (bbb222)")
    expect(second).not.toBe(first)
  })

  it("falls back to the id when a design has no usable name", () => {
    expect(designOptionValue({ id: "des_x", name: "" })).toBe("Design des_x")
    expect(designOptionValue({ id: "des_x", name: "   " })).toBe("Design des_x")
    expect(designOptionValue({ id: "des_x", name: null })).toBe("Design des_x")
  })

  it("does not reuse the legacy literal that caused the collision", () => {
    expect(designOptionValue({ id: "des_a", name: "Kalamkari" }, ["Custom"])).not.toBe("Custom")
  })
})

describe("designProductNaming — the product stops being called 'Custom'", () => {
  const design = {
    id: "01KWKHSQ8FDGSKNW4FNY3K5FF0",
    name: "Embroidered jacket",
    design_type: "Original",
  }

  it("titles the product after the design, with no 'Custom Design - ' prefix", () => {
    // The real product this replaced was titled "Custom Design - Embroidered jacket".
    expect(designProductNaming(design).title).toBe("Embroidered jacket")
    expect(designProductNaming(design).title).not.toMatch(/Custom Design/)
  })

  it("uses design_type as the option title instead of the generic 'Type'", () => {
    expect(designProductNaming(design).optionTitle).toBe("Original")
  })

  it("never claims the literal 'Custom' as an option value (#1874)", () => {
    // The value the appended branch already avoids: two designs on one product
    // resolved to an identical option tuple.
    const n = designProductNaming(design)
    expect(n.optionValue).toBe("Embroidered jacket")
    expect(n.optionValue).not.toBe("Custom")
    expect(n.variantTitle).not.toBe("Custom Design")
  })

  it("agrees with designOptionValue, so the two branches cannot drift apart", () => {
    expect(designProductNaming(design).optionValue).toBe(designOptionValue(design))
  })

  it("falls back to 'Type' for an unclassified design rather than an empty option title", () => {
    expect(designProductNaming({ id: "d1", name: "Stole" }).optionTitle).toBe("Type")
    expect(
      designProductNaming({ id: "d1", name: "Stole", design_type: "  " }).optionTitle
    ).toBe("Type")
  })

  it("still names a design with no name at all", () => {
    expect(designProductNaming({ id: "des_x" }).title).toBe("Design des_x")
  })
})

/**
 * 🔴 #2030 item 3 — the minted variant had no size, ever.
 *
 * Reproduced on prod 2026-09-14 in a clean room: design `01M2F1649Y82W0NYW4T9TXV9NF`
 * carried size_sets S and M from the moment it was created; the product minted
 * from it 28 minutes later (`prod_01M2F2V2C1A656WMHTX0FFNKDH`) had ONE variant,
 * sku `CUSTOM-01M2F1649Y82W0NYW4T9TXV9NF`, a single option titled "Original"
 * whose only value was the design's name, and neither "S" nor "M" anywhere.
 * No order, no run, no partner — so this was never an order-89 accident.
 */
describe("resolveDesignSizeLabel — #2030 item 3", () => {
  it("names the size when the design states exactly one", () => {
    expect(resolveDesignSizeLabel({ size_sets: [{ size_label: "M" }] })).toBe("M")
  })

  it("ABSTAINS on two sizes rather than picking one and being confidently wrong", () => {
    // The whole point. Order 89's placeholder was not mislabelled — it had no
    // size to be right about. Guessing "S" here would recreate that, with a
    // sku that now looks authoritative.
    expect(
      resolveDesignSizeLabel({ size_sets: [{ size_label: "S" }, { size_label: "M" }] })
    ).toBeNull()
  })

  it("abstains when the design states no sizes at all", () => {
    expect(resolveDesignSizeLabel({ size_sets: [] })).toBeNull()
    expect(resolveDesignSizeLabel({})).toBeNull()
    expect(resolveDesignSizeLabel({ size_sets: null })).toBeNull()
  })

  it("treats a blank label as no label — '' must not become a sku suffix", () => {
    // `''` passes a truthiness-free `!= null` check and would mint `CUSTOM-<id>-`.
    expect(resolveDesignSizeLabel({ size_sets: [{ size_label: "   " }] })).toBeNull()
    expect(resolveDesignSizeLabel({ size_sets: [{ size_label: null }] })).toBeNull()
  })

  it("counts only usable labels, so one real size beside a blank still resolves", () => {
    expect(
      resolveDesignSizeLabel({ size_sets: [{ size_label: "L" }, { size_label: "" }] })
    ).toBe("L")
  })
})

describe("designProductNaming — the variant carries the size (#2030 item 3)", () => {
  const single = { id: "des_1", name: "Tweed Jacket", design_type: "Original", size_sets: [{ size_label: "M" }] }
  const multi = { id: "des_2", name: "Tweed Jacket", design_type: "Original", size_sets: [{ size_label: "S" }, { size_label: "M" }] }

  it("puts the size in the variant sku, which is what a human can read", () => {
    expect(designProductNaming(single).variantSku).toBe("CUSTOM-des_1-M")
  })

  it("puts the size in the variant title", () => {
    expect(designProductNaming(single).variantTitle).toBe("Tweed Jacket — M")
  })

  it("🔑 leaves the OPTION untouched, so #1874's per-design tuple still holds", () => {
    // The size rides on the variant. Adding a size axis to the option would
    // change the variant tuple, the price fanout and the per-variant inventory
    // item — a different, much larger change.
    const naming = designProductNaming(single)
    expect(naming.optionValue).toBe("Tweed Jacket")
    expect(naming.optionTitle).toBe("Original")
    expect(naming.optionValue).toBe(designOptionValue(single))
  })

  it("falls back to the old sizeless sku for a multi-size design", () => {
    expect(designProductNaming(multi).variantSku).toBe("CUSTOM-des_2")
    expect(designProductNaming(multi).variantTitle).toBe("Tweed Jacket")
    expect(designProductNaming(multi).sizeLabel).toBeNull()
  })

  it("is unchanged for a design with no sizes — the pre-#2030 behaviour exactly", () => {
    const none = { id: "des_3", name: "Tweed Jacket", design_type: "Original" }
    expect(designProductNaming(none).variantSku).toBe("CUSTOM-des_3")
    expect(designProductNaming(none).variantTitle).toBe("Tweed Jacket")
  })
})

/**
 * 🔑 #2030 item 3, second half — the RUN knows better than the design.
 *
 * `approve-run-output` mints through this same workflow and passes the run's
 * own snapshot size. Order 89 is the shape that motivated it: the design states
 * S and M (so the design-level rule abstains, correctly — the design really is
 * ambiguous), while the run that made the garment snapshots [M] and is not
 * ambiguous at all.
 */
describe("designProductNaming — the caller's size wins (#2030 item 3)", () => {
  const ambiguous = {
    id: "des_89",
    name: "Cream Hand Loom Tweed Jacket",
    design_type: "Original",
    size_sets: [{ size_label: "S" }, { size_label: "M" }],
  }

  it("🔴 ORDER 89: an ambiguous design + a run that says M mints an M", () => {
    // Without the override this abstains — see the sibling test below, which is
    // the behaviour that let order 89 bind to a sizeless placeholder.
    const naming = designProductNaming(ambiguous, "M")
    expect(naming.sizeLabel).toBe("M")
    expect(naming.variantSku).toBe("CUSTOM-des_89-M")
    expect(naming.variantTitle).toBe("Cream Hand Loom Tweed Jacket — M")
  })

  it("...and abstains without it, so the override is doing the work", () => {
    expect(designProductNaming(ambiguous).sizeLabel).toBeNull()
    expect(designProductNaming(ambiguous).variantSku).toBe("CUSTOM-des_89")
  })

  it("overrides the design even when the design states exactly one size", () => {
    // The run is the record of what was MADE; the design is what was asked for.
    const single = { id: "des_1", name: "Jacket", design_type: "Original", size_sets: [{ size_label: "S" }] }
    expect(designProductNaming(single, "L").variantSku).toBe("CUSTOM-des_1-L")
  })

  it("treats a blank override as no answer and falls back to the design", () => {
    // `''` must not mint `CUSTOM-des_1-`.
    const single = { id: "des_1", name: "Jacket", design_type: "Original", size_sets: [{ size_label: "S" }] }
    expect(designProductNaming(single, "").variantSku).toBe("CUSTOM-des_1-S")
    expect(designProductNaming(single, "   ").variantSku).toBe("CUSTOM-des_1-S")
    expect(designProductNaming(single, null).variantSku).toBe("CUSTOM-des_1-S")
  })

  it("leaves the option alone regardless of the override (#1874)", () => {
    expect(designProductNaming(ambiguous, "M").optionValue).toBe("Cream Hand Loom Tweed Jacket")
  })
})

/**
 * A run SNAPSHOT is the same shape the design rule reads, which is why
 * `approve-run-output` reuses `resolveDesignSizeLabel` rather than growing a
 * second, drifting copy of the "exactly one" rule.
 */
describe("resolveDesignSizeLabel — over a run snapshot", () => {
  it("reads order 89's run snapshot as M", () => {
    // Verbatim shape from prod_run_01M09V91A1VDN0ABSXMTBXNW4M.
    const snapshot = { size_sets: [{ size_label: "M", design_id: "01M09V81MT94NSSZBJCQF79EXR" }] }
    expect(resolveDesignSizeLabel(snapshot)).toBe("M")
  })

  it("abstains on a run whose snapshot names both sizes", () => {
    // The September runs on that design snapshot [S, M] — a run that does not
    // say which one it made is not an answer either.
    expect(resolveDesignSizeLabel({ size_sets: [{ size_label: "S" }, { size_label: "M" }] })).toBeNull()
  })

  it("abstains on an empty snapshot rather than throwing", () => {
    expect(resolveDesignSizeLabel({})).toBeNull()
  })
})

/**
 * `approve-run-output` mints per DESIGN, so several completed runs of one design
 * are approved together and "the run's size" has to be resolved across them.
 */
describe("resolveRunsSizeLabel — a batch of runs (#2030 item 3)", () => {
  const run = (labels: string[]) => ({
    snapshot: { size_sets: labels.map((l) => ({ size_label: l })) },
  })

  it("🔴 ORDER 89: two runs that both made an M resolve to M", () => {
    // prod_run_...MVVR9T and its child ...BXNW4M both snapshot [M].
    expect(resolveRunsSizeLabel([run(["M"]), run(["M"])])).toBe("M")
  })

  it("abstains when two runs disagree — a product cannot be both", () => {
    expect(resolveRunsSizeLabel([run(["S"]), run(["M"])])).toBeNull()
  })

  it("a run that names no single size contributes NOTHING, not a veto (#1877)", () => {
    // The September runs snapshot [S, M] — no answer. A sibling that DID say M
    // still carries the batch, rather than being blocked by the silent one.
    expect(resolveRunsSizeLabel([run(["M"]), run(["S", "M"])])).toBe("M")
  })

  it("abstains when no run says anything", () => {
    expect(resolveRunsSizeLabel([run(["S", "M"]), run([])])).toBeNull()
    expect(resolveRunsSizeLabel([])).toBeNull()
    expect(resolveRunsSizeLabel(null)).toBeNull()
  })

  it("survives a run with no snapshot at all rather than throwing", () => {
    expect(resolveRunsSizeLabel([{}, null, run(["L"])])).toBe("L")
  })
})

/**
 * The append branch's option payload (#1970).
 *
 * Isolated by probe against the real product service: `{ id, product_id, title,
 * values }` throws `Cannot read properties of undefined (reading 'fieldNames')`
 * from MikroORM, `{ id, values }` does not. Every second mint for a design that
 * already had a product crashed on it.
 */
describe("appendOptionValuePayload", () => {
  it("🔴 targets the product↔option pair, not the option row", () => {
    // upsertProductOptions is the wrong API here: with product_id it throws
    // inside MikroORM, and without it it returns OK and persists NOTHING.
    expect(appendOptionValuePayload("prod_1", { id: "opt_1" }, "Shawl B")).toEqual({
      product_id: "prod_1",
      product_option_id: "opt_1",
      add: [{ value: "Shawl B" }],
    })
  })

  it("🔴 wraps the value as a create-object, never a bare string", () => {
    // A bare string is read as a value ID: "you tried to set relationship
    // product_option_value_id ... but such entity does not exist".
    const payload = appendOptionValuePayload("prod_1", { id: "opt_1" }, "X")
    expect(payload.add).toEqual([{ value: "X" }])
    expect(typeof payload.add[0]).toBe("object")
  })

  it("adds only the new value — it never restates the existing ones", () => {
    // The API is additive. Passing the full list would be the replace-shaped
    // thinking that produced the silent no-op.
    expect(
      appendOptionValuePayload("prod_1", { id: "opt_1" }, "C").add
    ).toHaveLength(1)
  })
})
