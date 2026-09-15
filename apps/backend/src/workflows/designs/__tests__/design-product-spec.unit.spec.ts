import {
  buildDesignSpec,
  designSizeLabels,
} from "../lib/design-product-spec"

/**
 * #1970 — a design's sizes become a customer CHOICE, not seven variants.
 *
 * The cases worth pinning are the ones where the obvious implementation is
 * wrong: a single size rendered as a one-answer question, duplicate labels
 * rendered as two identical buttons, and any temptation to sort free text.
 */

describe("designSizeLabels", () => {
  it("keeps the partner's own order", () => {
    expect(
      designSizeLabels({
        size_sets: [
          { size_label: "XL" },
          { size_label: "S" },
          { size_label: "M" },
        ],
      })
    ).toEqual(["XL", "S", "M"])
  })

  it("🔴 does NOT sort — the labels are free text", () => {
    // Prod carries "Custom Bag" alongside S/M/XL. Any size order we imposed
    // would reorder someone's list on a guess.
    expect(
      designSizeLabels({
        size_sets: [{ size_label: "Custom Bag" }, { size_label: "M" }],
      })
    ).toEqual(["Custom Bag", "M"])
  })

  it("🔴 dedupes — two identical buttons is not a choice", () => {
    expect(
      designSizeLabels({
        size_sets: [
          { size_label: "M" },
          { size_label: "M " },
          { size_label: "S" },
        ],
      })
    ).toEqual(["M", "S"])
  })

  it("ignores blanks and missing rows", () => {
    expect(
      designSizeLabels({
        size_sets: [
          { size_label: "" },
          { size_label: "   " },
          { size_label: null },
          null,
          { size_label: "M" },
        ],
      })
    ).toEqual(["M"])
    expect(designSizeLabels({ size_sets: null })).toEqual([])
    expect(designSizeLabels({})).toEqual([])
  })
})

describe("buildDesignSpec", () => {
  it("makes several sizes a required choice", () => {
    const spec = buildDesignSpec({
      size_sets: [
        { size_label: "S" },
        { size_label: "M" },
        { size_label: "L" },
      ],
    })

    expect(spec?.options).toHaveLength(1)
    const group = spec!.options![0]
    expect(group.key).toBe("size")
    expect(group.required).toBe(true)
    expect(group.values.map((v) => v.label)).toEqual(["S", "M", "L"])
    // Order is carried explicitly — the storefront renders by it.
    expect(group.values.map((v) => v.order)).toEqual([0, 1, 2])
  })

  it("🔴 a SINGLE size is a stated fact, not a one-answer question", () => {
    // One option with one value asks the customer something they cannot answer
    // two ways, and reads as an unfinished page.
    const spec = buildDesignSpec({ size_sets: [{ size_label: "M" }] })
    expect(spec).toEqual({ size_label: "M" })
    expect(spec?.options).toBeUndefined()
  })

  it("🔴 a design with no sizes gets NO spec at all", () => {
    // An empty spec row would give every design product a made-to-spec surface
    // with nothing on it.
    expect(buildDesignSpec({ size_sets: [] })).toBeNull()
    expect(buildDesignSpec({ size_sets: null })).toBeNull()
    expect(buildDesignSpec({ size_sets: [{ size_label: "  " }] })).toBeNull()
  })

  it("clears a stale size_label when the design becomes multi-size", () => {
    // The spec upsert replaces the option groups wholesale; size_label is a
    // separate column and would otherwise keep claiming the old single size
    // beside a group offering three.
    const spec = buildDesignSpec({
      size_sets: [{ size_label: "S" }, { size_label: "M" }],
    })
    expect(spec?.size_label).toBeNull()
  })

  it("does not invent a colour palette or a lead time", () => {
    const spec = buildDesignSpec({
      size_sets: [{ size_label: "S" }, { size_label: "M" }],
    })
    expect(spec?.colors).toBeUndefined()
    expect(spec?.custom_order_lead_time_days).toBeUndefined()
  })

  /**
   * 🔴 The gate on BOTH ends, and this assertion used to read
   * `toBeUndefined()` — the defect written down as intent.
   *
   * `accepting_custom_orders` is not a display preference. The storefront
   * renders the choices only when it is true (`offersChoices` in
   * `product-actions`), and `/store/carts/:id/made-to-spec` refuses the line
   * without it. So the size group was written, stored, served by
   * `/store/products/:id/spec` — and invisible on the page and un-orderable in
   * the cart. The first run of `storefront-design-made-to-spec.spec.ts` is what
   * surfaced it: no "Size" text anywhere, add-to-cart stuck on "Select variant".
   */
  it("🔴 accepts custom orders — otherwise the size group is inert", () => {
    const spec = buildDesignSpec({
      size_sets: [{ size_label: "S" }, { size_label: "M" }],
    })
    expect(spec?.accepting_custom_orders).toBe(true)
  })

  /** One stated size is a fact about the piece, so there is nothing to accept. */
  it("does NOT accept custom orders for a single-size design", () => {
    const spec = buildDesignSpec({ size_sets: [{ size_label: "M" }] })
    expect(spec?.size_label).toBe("M")
    expect(spec?.accepting_custom_orders).toBeUndefined()
  })
})
