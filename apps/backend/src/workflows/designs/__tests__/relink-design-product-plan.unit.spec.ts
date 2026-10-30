import {
  isRelinkRefusal,
  planDesignProductRelink,
  type RelinkInput,
  type RelinkPlan,
} from "../lib/relink-design-product-plan"

/**
 * Shaped on the prod case that asked for this (#2477): "Butterfly Shirt with
 * Lace" was minted onto its own draft, while its garments are sold as the lace
 * S/M variants of Butterfly Shirt.
 */
const LACE = "design_lace"
const PLAIN = "design_plain"
const OLD = "prod_old_lace_draft"
const BUTTERFLY = "prod_butterfly"

const base = (over: Partial<RelinkInput> = {}): RelinkInput => ({
  designId: LACE,
  target: { id: BUTTERFLY, variant_ids: ["v_cotton_l", "v_lace_s", "v_lace_m"] },
  linkedProductIds: [OLD],
  designVariants: [
    { variant_id: "v_old_default", product_id: OLD },
    { variant_id: "v_old_m", product_id: OLD },
    { variant_id: "v_old_s", product_id: OLD },
  ],
  requestedVariantIds: ["v_lace_s", "v_lace_m"],
  variantDesigns: new Map(),
  runs: [
    { id: "run_parent", product_id: null, variant_id: null },
    { id: "run_child", product_id: OLD, variant_id: null },
  ],
  ...over,
})

const plan = (over: Partial<RelinkInput> = {}): RelinkPlan => {
  const r = planDesignProductRelink(base(over))
  if (isRelinkRefusal(r)) throw new Error(`refused: ${r.message}`)
  return r
}

describe("planDesignProductRelink", () => {
  it("moves the product link, replaces the variant links and repoints the run", () => {
    const p = plan()
    expect(p.link_product).toBe(true)
    expect(p.unlink_product_ids).toEqual([OLD])
    expect(p.link_variant_ids).toEqual(["v_lace_s", "v_lace_m"])
    expect(p.unlink_variant_ids.sort()).toEqual(["v_old_default", "v_old_m", "v_old_s"])
    expect(p.runs).toEqual([{ run_id: "run_child", update: { product_id: BUTTERFLY } }])
    expect(p.noop).toBe(false)
  })

  it("refuses a variant that is not on the target product", () => {
    const r = planDesignProductRelink(base({ requestedVariantIds: ["v_old_m"] }))
    expect(isRelinkRefusal(r) && r.error).toBe("variant_not_on_product")
  })

  it("refuses a missing product", () => {
    const r = planDesignProductRelink(base({ target: null }))
    expect(isRelinkRefusal(r) && r.error).toBe("product_not_found")
  })

  it("refuses to take a variant from another design unless told to", () => {
    const variantDesigns = new Map([["v_lace_s", PLAIN]])
    const r = planDesignProductRelink(base({ variantDesigns }))
    expect(isRelinkRefusal(r) && r.error).toBe("variant_belongs_to_another_design")

    const p = plan({ variantDesigns, moveVariantsFromOtherDesigns: true })
    expect(p.moved_variants).toEqual([{ variant_id: "v_lace_s", from_design_id: PLAIN }])
  })

  it("a variant this design already backs is not a move", () => {
    const p = plan({ variantDesigns: new Map([["v_lace_s", LACE]]) })
    expect(p.moved_variants).toEqual([])
  })

  it("clears a run variant that no longer fits, and repoints an approval stamp", () => {
    const p = plan({
      runs: [
        {
          id: "run_x",
          product_id: OLD,
          variant_id: "v_old_m",
          approved_product_id: OLD,
          approved_variant_id: "v_old_m",
        },
        { id: "run_ok", product_id: BUTTERFLY, variant_id: "v_lace_m" },
      ],
    })
    expect(p.runs).toEqual([
      {
        run_id: "run_x",
        update: {
          product_id: BUTTERFLY,
          variant_id: null,
          approved_product_id: BUTTERFLY,
          approved_variant_id: null,
        },
      },
    ])
  })

  it("without variant_ids keeps only the links already on the target", () => {
    const p = plan({
      requestedVariantIds: null,
      designVariants: [
        { variant_id: "v_old_m", product_id: OLD },
        { variant_id: "v_lace_m", product_id: BUTTERFLY },
      ],
    })
    expect(p.link_variant_ids).toEqual([])
    expect(p.unlink_variant_ids).toEqual(["v_old_m"])
  })

  it("is a no-op when everything already points at the target", () => {
    const p = plan({
      linkedProductIds: [BUTTERFLY],
      designVariants: [
        { variant_id: "v_lace_s", product_id: BUTTERFLY },
        { variant_id: "v_lace_m", product_id: BUTTERFLY },
      ],
      runs: [{ id: "run_child", product_id: BUTTERFLY, variant_id: null }],
    })
    expect(p.noop).toBe(true)
  })
})
