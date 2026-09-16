import {
  diffApprovalTarget,
  indexVariantOwners,
  resolveRunApprovalStamp,
} from "../lib/run-variant"

/**
 * PR3 (#1970). Two things the design-level approval target could not express:
 * which variant a SINGLE run produced, and what a re-approval actually changed.
 */
describe("resolveRunApprovalStamp — the binding is per run, not per design", () => {
  const target = { product_id: "prod_1", variant_id: "var_design" }

  it("prefers the run's own variant over the design-level answer", () => {
    const stamp = resolveRunApprovalStamp({ variant_id: "var_run" }, target)
    expect(stamp).toEqual({
      product_id: "prod_1",
      variant_id: "var_run",
      source: "run",
    })
  })

  it("falls back to the design target when the run names nothing", () => {
    expect(resolveRunApprovalStamp({ variant_id: null }, target)).toEqual({
      product_id: "prod_1",
      variant_id: "var_design",
      source: "design",
    })
  })

  /**
   * 🔴 The regression PR3 exists for. `resolveDesignApprovalTarget` refuses
   * with `runs_disagree` and a null variant when two runs made different
   * variants — and that refusal used to null the variant on BOTH runs, even
   * though each one said exactly what it produced.
   */
  it("still stamps each run when the design-level target REFUSED", () => {
    const refused = { product_id: "prod_1", variant_id: null }
    const runs = [{ variant_id: "var_small" }, { variant_id: "var_medium" }]

    const stamps = runs.map((r) => resolveRunApprovalStamp(r, refused))

    expect(stamps.map((s) => s.variant_id)).toEqual(["var_small", "var_medium"])
    expect(stamps.every((s) => s.source === "run")).toBe(true)
    // and they are not collapsed onto one another
    expect(new Set(stamps.map((s) => s.variant_id)).size).toBe(2)
  })

  it("places the product from the variant's real owner, not the design's", () => {
    const owners = indexVariantOwners([
      { id: "prod_a", variants: [{ id: "var_a" }] },
      { id: "prod_b", variants: [{ id: "var_b" }] },
    ])

    expect(
      resolveRunApprovalStamp({ variant_id: "var_b" }, { product_id: "prod_a" }, owners)
    ).toEqual({ product_id: "prod_b", variant_id: "var_b", source: "run" })
  })

  it("keeps the design's product when the variant cannot be placed", () => {
    const owners = indexVariantOwners([{ id: "prod_a", variants: [{ id: "var_a" }] }])

    // Never widened to a guess — but never narrowed to null either, which
    // would drop a product id the old behaviour did record.
    expect(
      resolveRunApprovalStamp({ variant_id: "var_orphan" }, { product_id: "prod_a" }, owners)
    ).toEqual({ product_id: "prod_a", variant_id: "var_orphan", source: "run" })
  })

  it("reports source 'none' when neither the run nor the design can answer", () => {
    expect(resolveRunApprovalStamp({}, { product_id: "prod_1", variant_id: null })).toEqual({
      product_id: "prod_1",
      variant_id: null,
      source: "none",
    })
  })

  it("survives null runs and a null target", () => {
    expect(resolveRunApprovalStamp(null, null)).toEqual({
      product_id: null,
      variant_id: null,
      source: "none",
    })
  })
})

describe("indexVariantOwners", () => {
  it("skips products with no id and variants with no id", () => {
    const index = indexVariantOwners([
      null,
      { id: null, variants: [{ id: "orphan" }] },
      { id: "prod_a", variants: [{ id: null }, { id: "var_a" }] },
    ])
    expect(index.get("var_a")).toBe("prod_a")
    expect(index.has("orphan")).toBe(false)
    expect(index.size).toBe(1)
  })
})

describe("diffApprovalTarget — what the approval changed", () => {
  it("reports a fresh mint as created", () => {
    expect(
      diffApprovalTarget({
        productExisted: false,
        productId: "prod_1",
        variantId: "var_1",
        computedPrice: 100,
        currency: "inr",
      })
    ).toEqual({ product: "created", variant: "created" })
  })

  it("reports an unresolved variant rather than implying one was made", () => {
    const diff = diffApprovalTarget({
      productExisted: false,
      productId: "prod_1",
      variantId: null,
    })
    expect(diff.product).toBe("created")
    expect(diff.variant).toBe("unresolved")
  })

  /**
   * 🔴 The case the boolean could not express: re-approved at a different
   * price, and the listing still shows the old one.
   */
  it("flags a reused listing whose price no longer matches the computed one", () => {
    const diff = diffApprovalTarget({
      productExisted: true,
      productId: "prod_1",
      variantId: "var_1",
      computedPrice: 12_000,
      currency: "inr",
      existingPrices: [
        { amount: 9_000, currency_code: "inr" },
        { amount: 250, currency_code: "eur" },
      ],
    })

    expect(diff).toEqual({
      product: "reused",
      variant: "reused",
      listed_price_before: 9_000,
      price_stale: true,
    })
  })

  it("does not flag a reused listing that still agrees", () => {
    const diff = diffApprovalTarget({
      productExisted: true,
      variantId: "var_1",
      computedPrice: 9_000,
      currency: "INR", // currency comparison is case-insensitive
      existingPrices: [{ amount: 9_000, currency_code: "inr" }],
    })
    expect(diff.price_stale).toBe(false)
    expect(diff.listed_price_before).toBe(9_000)
  })

  /** `0` is a real listed price; `||` would read it as "nothing listed". */
  it("treats a listed 0 as a price, not as absent", () => {
    const diff = diffApprovalTarget({
      productExisted: true,
      variantId: "var_1",
      computedPrice: 500,
      currency: "inr",
      existingPrices: [{ amount: 0, currency_code: "inr" }],
    })
    expect(diff.listed_price_before).toBe(0)
    expect(diff.price_stale).toBe(true)
  })

  it("says nothing about staleness when the currency is not listed at all", () => {
    const diff = diffApprovalTarget({
      productExisted: true,
      variantId: "var_1",
      computedPrice: 500,
      currency: "inr",
      existingPrices: [{ amount: 250, currency_code: "eur" }],
    })
    expect(diff.listed_price_before).toBeNull()
    expect(diff.price_stale).toBeUndefined()
  })

  it("does not inspect prices at all when the variant is unresolved", () => {
    const diff = diffApprovalTarget({
      productExisted: true,
      variantId: null,
      computedPrice: 500,
      currency: "inr",
      existingPrices: [{ amount: 9_000, currency_code: "inr" }],
    })
    expect(diff).toEqual({ product: "reused", variant: "unresolved" })
  })
})
