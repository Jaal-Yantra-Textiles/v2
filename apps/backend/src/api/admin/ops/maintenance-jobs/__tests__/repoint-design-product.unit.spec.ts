import { planRepointDesignProduct, type RepointInput } from "../repoint-design-product-job"

/**
 * #2326 — "Butterfly in muslin" moves onto the Muslin variants of the single
 * "Butterfly Shirt" product. Its old variant (and order #83's line on it) stay.
 */
const MUSLIN: RepointInput = {
  design_id: "design_muslin",
  product_id: "prod_shirt",
  variant_ids: ["var_muslin_l", "var_muslin_s"],
  current: [{ variant_id: "var_old", product_id: "prod_old" }],
  targets: [
    { variant_id: "var_muslin_l", product_id: "prod_shirt", design_id: null },
    { variant_id: "var_muslin_s", product_id: "prod_shirt", design_id: null },
  ],
  linked_product_ids: ["prod_old"],
}

describe("planRepointDesignProduct (#2326)", () => {
  it("links the new variants, drops the old product's, and moves the product link", () => {
    expect(planRepointDesignProduct(MUSLIN)).toEqual({
      ok: true,
      link_variants: ["var_muslin_l", "var_muslin_s"],
      unlink_variants: ["var_old"],
      link_product: true,
      unlink_products: ["prod_old"],
    })
  })

  it("is idempotent — a design already on the product changes nothing", () => {
    const plan = planRepointDesignProduct({
      ...MUSLIN,
      current: [
        { variant_id: "var_muslin_l", product_id: "prod_shirt" },
        { variant_id: "var_muslin_s", product_id: "prod_shirt" },
      ],
      targets: MUSLIN.targets.map((t) => ({ ...t, design_id: "design_muslin" })),
      linked_product_ids: ["prod_shirt"],
    })
    expect(plan).toEqual({
      ok: true,
      link_variants: [],
      unlink_variants: [],
      link_product: false,
      unlink_products: [],
    })
  })

  it("keeps the design's other variants on the target product", () => {
    const plan = planRepointDesignProduct({
      ...MUSLIN,
      current: [...MUSLIN.current, { variant_id: "var_other", product_id: "prod_shirt" }],
    })
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.unlink_variants).toEqual(["var_old"])
  })

  it("refuses a variant that belongs to another design", () => {
    const plan = planRepointDesignProduct({
      ...MUSLIN,
      targets: [
        { variant_id: "var_muslin_l", product_id: "prod_shirt", design_id: "design_cotton" },
        MUSLIN.targets[1],
      ],
    })
    expect(plan).toEqual({ ok: false, reason: "variant var_muslin_l already belongs to design design_cotton" })
  })

  it("refuses a variant on a different product, or one that does not exist", () => {
    expect(
      planRepointDesignProduct({
        ...MUSLIN,
        targets: [{ ...MUSLIN.targets[0], product_id: "prod_else" }, MUSLIN.targets[1]],
      })
    ).toEqual({ ok: false, reason: "variant var_muslin_l is on prod_else, not prod_shirt" })
    expect(planRepointDesignProduct({ ...MUSLIN, targets: [MUSLIN.targets[1]] })).toEqual({
      ok: false,
      reason: "variant var_muslin_l not found",
    })
  })
})
