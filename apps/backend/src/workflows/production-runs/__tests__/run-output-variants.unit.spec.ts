jest.mock("@medusajs/medusa/core-flows", () => ({
  createAndLinkProductOptionsToProductWorkflow: jest.fn(),
  createProductVariantsWorkflow: jest.fn(),
}))
jest.mock("../../designs/design-product-plan", () => ({ applyDesignProductPlan: jest.fn() }))
jest.mock("../../../modules/production_runs/cost-summary", () => ({
  computeRunCostSummary: jest.fn(),
}))
jest.mock("../../../modules/platform-cost-config/read-config", () => ({
  loadCostConfig: jest.fn(),
}))

import {
  MADE_TO_ORDER,
  needsLinePath,
  planOutputVariants,
  type PlanProduct,
} from "../lib/run-output-variants"

/**
 * #2271 — one variant per size/colour a run made.
 *
 * The Luong Shirt shape: a draft product minted from the design with ONE
 * variant whose only option says which design it is.
 */
const LUONG_PRODUCT: PlanProduct = {
  id: "prod_luong",
  options: [{ id: "opt_design", title: "Original", values: [{ value: "Luong Shirt" }] }],
  variants: [
    {
      id: "var_base",
      sku: "CUSTOM-D1",
      title: "Luong Shirt",
      options: [{ value: "Luong Shirt", option: { title: "Original" } }],
      prices: [{ amount: 1144, currency_code: "inr" }],
    },
  ],
}

const S1_M2 = [
  { size_label: "S", color: null, quantity: 1 },
  { size_label: "M", color: null, quantity: 2 },
]

describe("planOutputVariants (#2271)", () => {
  it("adds a Size axis, backfills the existing variant as Made to order, and plans S and M", () => {
    const plan = planOutputVariants({
      product: LUONG_PRODUCT,
      designVariantIds: ["var_base"],
      lines: S1_M2,
    })
    if (!plan.ok) throw new Error(plan.detail)

    expect(plan.add_options).toEqual([{ title: "Size", values: ["S", "M", MADE_TO_ORDER] }])
    expect(plan.backfill).toEqual([
      { variant_id: "var_base", options: { Original: "Luong Shirt", Size: MADE_TO_ORDER } },
    ])
    expect(plan.base_options).toEqual({ Original: "Luong Shirt" })
    // Neither size exists yet — the base variant is Made to order, not S or M.
    expect(plan.lines.map((l) => [l.axis_values, l.variant_id])).toEqual([
      [{ Size: "S" }, undefined],
      [{ Size: "M" }, undefined],
    ])
  })

  it("reuses the variants a previous run created — idempotent", () => {
    const product: PlanProduct = {
      id: "prod_luong",
      options: [
        { id: "opt_design", title: "Original", values: [{ value: "Luong Shirt" }] },
        { id: "opt_size", title: "Size", values: [{ value: "S" }, { value: MADE_TO_ORDER }] },
      ],
      variants: [
        {
          id: "var_base",
          options: [
            { value: "Luong Shirt", option: { title: "Original" } },
            { value: MADE_TO_ORDER, option: { title: "Size" } },
          ],
        },
        {
          id: "var_s",
          options: [
            { value: "Luong Shirt", option: { title: "Original" } },
            { value: "S", option: { title: "Size" } },
          ],
        },
      ],
    }
    const plan = planOutputVariants({
      product,
      designVariantIds: ["var_base", "var_s"],
      lines: S1_M2,
    })
    if (!plan.ok) throw new Error(plan.detail)
    expect(plan.add_options).toEqual([])
    expect(plan.backfill).toEqual([])
    expect(plan.add_values).toEqual([{ option_id: "opt_size", title: "Size", values: ["M"] }])
    expect(plan.lines.find((l) => l.size_label === "S")?.variant_id).toBe("var_s")
    expect(plan.lines.find((l) => l.size_label === "M")?.variant_id).toBeUndefined()
  })

  it("a sizeless line on a sizeless product banks onto the design's variant", () => {
    const plan = planOutputVariants({
      product: LUONG_PRODUCT,
      designVariantIds: ["var_base"],
      lines: [{ size_label: null, color: null, quantity: 1 }],
    })
    if (!plan.ok) throw new Error(plan.detail)
    expect(plan.add_options).toEqual([])
    expect(plan.lines[0].variant_id).toBe("var_base")
  })

  /** Other designs' variants are not this run's to relabel. */
  it("REFUSES to add an axis to a product shared with another design", () => {
    const shared: PlanProduct = {
      ...LUONG_PRODUCT,
      variants: [
        ...(LUONG_PRODUCT.variants ?? []),
        { id: "var_other", options: [{ value: "Other Shirt", option: { title: "Original" } }] },
      ],
    }
    const plan = planOutputVariants({
      product: shared,
      designVariantIds: ["var_base"],
      lines: S1_M2,
    })
    expect(plan).toMatchObject({ ok: false, reason: "shared_product" })
  })

  it("refuses when two design variants claim the same combination", () => {
    const plan = planOutputVariants({
      product: {
        ...LUONG_PRODUCT,
        variants: [
          ...(LUONG_PRODUCT.variants ?? []),
          { id: "var_dup", options: [{ value: "Luong Shirt", option: { title: "Original" } }] },
        ],
      },
      designVariantIds: ["var_base", "var_dup"],
      lines: [{ size_label: null, color: null, quantity: 1 }],
    })
    expect(plan).toMatchObject({ ok: false, reason: "ambiguous_design_variants" })
  })

  it("refuses a product with no variant of this design", () => {
    expect(
      planOutputVariants({ product: LUONG_PRODUCT, designVariantIds: [], lines: S1_M2 })
    ).toMatchObject({ ok: false, reason: "no_design_variant" })
  })

  it("plans size x colour together", () => {
    const plan = planOutputVariants({
      product: LUONG_PRODUCT,
      designVariantIds: ["var_base"],
      lines: [{ size_label: "S", color: "Indigo", quantity: 1 }],
    })
    if (!plan.ok) throw new Error(plan.detail)
    expect(plan.add_options.map((o) => o.title)).toEqual(["Size", "Color"])
    expect(plan.lines[0].axis_values).toEqual({ Size: "S", Color: "Indigo" })
  })
})

describe("needsLinePath (#2271)", () => {
  const base = { run: {}, lines: null, axesStated: false, designHasProduct: true }

  it("keeps a run that names its variant, or a customer-order run, on the legacy path", () => {
    expect(needsLinePath({ ...base, run: { variant_id: "v" } })).toBe("legacy")
    expect(needsLinePath({ ...base, run: { order_id: "o" } })).toBe("legacy")
  })

  it("takes the line path for sized output", () => {
    expect(needsLinePath({ ...base, lines: [{ size_label: "S", quantity: 1 }] })).toBe("lines")
  })

  it("takes the line path to mint a draft when the design has no product", () => {
    expect(needsLinePath({ ...base, designHasProduct: false })).toBe("lines")
  })

  it("keeps a sizeless run whose design has a product on the legacy path", () => {
    expect(needsLinePath(base)).toBe("legacy")
    expect(needsLinePath({ ...base, run: { approved_variant_id: "v" } })).toBe("legacy")
  })

  /** Luong Shirt completed over WhatsApp: S and M stated, nobody said which. */
  it("refuses to guess when several sizes are stated and no split was recorded", () => {
    expect(needsLinePath({ ...base, axesStated: true })).toBe("split_unknown")
  })
})
