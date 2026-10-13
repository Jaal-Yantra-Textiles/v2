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

import { applyDesignProductPlan } from "../../designs/design-product-plan"
import {
  decideRunStockTarget,
  MADE_TO_ORDER,
  needsLinePath,
  planNewVariants,
  planOptionLinks,
  planOutputVariants,
  resolveDesignProductId,
  resolveRunStockTarget,
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

describe("planOptionLinks (#2326)", () => {
  // The shared Size prod holds since the first sized run, 2026-09-25.
  const SHARED_SIZE = {
    id: "opt_shared_size",
    title: "Size",
    values: [
      { id: "val_s", value: "S" },
      { id: "val_m", value: "M" },
      { id: "val_mto", value: MADE_TO_ORDER },
    ],
  }

  it("creates an axis no shared option has taken", () => {
    const links = planOptionLinks(
      { add_options: [{ title: "Size", values: ["S", MADE_TO_ORDER] }], add_values: [] },
      []
    )
    expect(links).toEqual({ add: [{ title: "Size", values: ["S", MADE_TO_ORDER] }], update: [] })
  })

  it("LINKS the shared Size instead of creating a second one, and adds the values it lacks", () => {
    const links = planOptionLinks(
      { add_options: [{ title: "Size", values: ["L", MADE_TO_ORDER] }], add_values: [] },
      [SHARED_SIZE]
    )
    expect(links.add).toEqual([{ id: "opt_shared_size", value_ids: ["val_mto"] }])
    expect(links.update).toEqual([{ product_option_id: "opt_shared_size", add: [{ value: "L" }] }])
  })

  it("links the bare shared option when it has none of the wanted values", () => {
    const links = planOptionLinks(
      { add_options: [{ title: "Size", values: ["XL"] }], add_values: [] },
      [SHARED_SIZE]
    )
    expect(links.add).toEqual(["opt_shared_size"])
    expect(links.update).toEqual([{ product_option_id: "opt_shared_size", add: [{ value: "XL" }] }])
  })

  it("keeps the product's own missing values, and creates only the axis that is free", () => {
    const links = planOptionLinks(
      {
        add_options: [
          { title: "Size", values: ["S"] },
          { title: "Color", values: ["White", MADE_TO_ORDER] },
        ],
        add_values: [{ option_id: "opt_own", title: "Fabric", values: ["Cotton"] }],
      },
      [SHARED_SIZE]
    )
    expect(links.add).toEqual([
      { id: "opt_shared_size", value_ids: ["val_s"] },
      { title: "Color", values: ["White", MADE_TO_ORDER] },
    ])
    expect(links.update).toEqual([{ product_option_id: "opt_own", add: [{ value: "Cotton" }] }])
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

/**
 * prod 2026-10-13, run prod_run_01M4R17H46GMJG3P2V9Q34KESJ: a design linked to a
 * published product at the PRODUCT level, its S/M/L variants not linked to the
 * design. Completion minted a `Size: Silk Jacket` variant onto that product,
 * then planned a `Made to order` one for the unsized piece, whose sku came out
 * as the template's own. Medusa refused it, as a 400, after side effects.
 */
describe("prod 2026-10-13: duplicate sku on a product-level-linked design", () => {
  const { createAndLinkProductOptionsToProductWorkflow, createProductVariantsWorkflow } =
    jest.requireMock("@medusajs/medusa/core-flows")

  const DESIGN_SKU = "CUSTOM-D1-1760000000000"
  const SILK_PRODUCT: PlanProduct = {
    id: "prod_silk",
    options: [
      {
        id: "opt_size",
        title: "Size",
        values: [{ value: "S" }, { value: "M" }, { value: "L" }, { value: "Silk Jacket" }],
      },
    ],
    variants: [
      { id: "var_s", sku: "SILK-S", title: "S", options: [{ value: "S", option: { title: "Size" } }] },
      { id: "var_m", sku: "SILK-M", title: "M", options: [{ value: "M", option: { title: "Size" } }] },
      { id: "var_l", sku: "SILK-L", title: "L", options: [{ value: "L", option: { title: "Size" } }] },
      {
        id: "var_design",
        sku: DESIGN_SKU,
        title: "Silk Jacket",
        options: [{ value: "Silk Jacket", option: { title: "Size" } }],
        prices: [{ amount: 5000, currency_code: "inr" }],
      },
    ],
  }
  const UNSIZED = [{ size_label: null, color: null, quantity: 1 }]

  /** A container whose query answers by entity, as `query.graph` would. */
  const fakeContainer = (rows: Record<string, any[]>) => {
    const query = {
      graph: jest.fn(async ({ entity }: { entity: string }) => ({ data: rows[entity] ?? [] })),
    }
    const services: Record<string, any> = {
      query,
      link: { create: jest.fn() },
      product: { updateProductVariants: jest.fn(), listProductOptions: jest.fn(async () => []) },
    }
    return { query, resolve: (key: string) => services[key] }
  }

  beforeEach(() => {
    createAndLinkProductOptionsToProductWorkflow.mockReset()
    createProductVariantsWorkflow.mockReset()
    ;(applyDesignProductPlan as jest.Mock).mockReset()
  })

  it("never plans a new variant whose sku equals the template's", () => {
    const plan = planOutputVariants({
      product: SILK_PRODUCT,
      designVariantIds: ["var_design"],
      lines: UNSIZED,
    })
    if (!plan.ok) throw new Error(`expected a plan, got ${plan.reason}`)
    // The unsized piece wants Size=Made to order, which no design variant has.
    expect(plan.lines[0].variant_id).toBeUndefined()

    const planned = planNewVariants({ design_id: "D1", plan, product: SILK_PRODUCT })
    expect(planned).toEqual({ ok: false, reason: expect.stringContaining(DESIGN_SKU) })
  })

  it("a refused sku becomes a skip with a reason, and no variant or option is written", async () => {
    // The incident's first attempt: no link at either level, so a draft mint
    // runs, and the mint lands a design variant on the existing product.
    const rows: Record<string, any[]> = {
      design_product_variant: [],
      product_design: [],
      design: [{ id: "D1", estimated_cost: 1000, cost_currency: "inr" }],
      product: [SILK_PRODUCT],
    }
    ;(applyDesignProductPlan as jest.Mock).mockImplementation(async () => {
      rows.design_product_variant = [{ product_variant_id: "var_design" }]
      return { product_id: "prod_silk" }
    })
    const container = fakeContainer(rows)

    const target = await resolveRunStockTarget(container, {
      run: { id: "run_1", design_id: "D1", produced_output: null },
      good_quantity: 1,
      has_location: true,
    })

    expect(applyDesignProductPlan).toHaveBeenCalledTimes(1)
    expect(target).toEqual({ mode: "skip", reason: expect.stringContaining(DESIGN_SKU) })
    expect(createProductVariantsWorkflow).not.toHaveBeenCalled()
    expect(createAndLinkProductOptionsToProductWorkflow).not.toHaveBeenCalled()
  })

  it("resolveDesignProductId falls back to the product-level link when no variant is linked", async () => {
    const container = fakeContainer({
      design_product_variant: [],
      product_design: [{ product_id: "prod_silk" }],
    })
    await expect(resolveDesignProductId(container, "D1")).resolves.toEqual({
      product_id: "prod_silk",
      ambiguous: false,
    })
  })

  it("several product-level links are ambiguous, never row 0", async () => {
    const container = fakeContainer({
      design_product_variant: [],
      product_design: [{ product_id: "prod_a" }, { product_id: "prod_b" }],
    })
    await expect(resolveDesignProductId(container, "D1")).resolves.toEqual({
      product_id: null,
      ambiguous: true,
    })
  })

  it("decideRunStockTarget does not plan a draft mint for a design already linked to a product", async () => {
    const container = fakeContainer({
      design_product_variant: [],
      product_design: [{ product_id: "prod_silk" }],
      // Priceable, so the pre-fix path would have planned a draft mint.
      design: [{ id: "D1", estimated_cost: 1000, cost_currency: "inr" }],
    })
    const decision = await decideRunStockTarget(container, {
      run: { id: "run_1", design_id: "D1", produced_output: null },
      good_quantity: 1,
      has_location: true,
    })
    expect(decision).toEqual({ mode: "legacy" })
  })
})
