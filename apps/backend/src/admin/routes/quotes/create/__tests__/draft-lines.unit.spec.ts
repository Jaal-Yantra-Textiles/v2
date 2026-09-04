import {
  basketFromDraftLines,
  conflictingOverrides,
  draftLinesFromForm,
} from "../draft-lines"

/**
 * The basket mapping, both directions (#1806).
 *
 * The defect this exists to stop is not exotic: the grid collected a negotiated
 * unit price, the save built a line without it, and the operator was told
 * "Items saved." The assertions below are therefore about what is SENT and what
 * is READ BACK, never about whether a call succeeded.
 */
describe("draftLinesFromForm", () => {
  it("carries the negotiated unit price onto the line", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 500 },
      overrides: { var_1: 1200 },
    })

    expect(lines).toEqual([
      { variant_id: "var_1", quantity: 500, position: 0, override_unit_amount: 1200 },
    ])
  })

  it("carries a discount percentage", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 500 },
      discounts: { var_1: 12.5 },
    })

    expect(lines[0].discount_percent).toBe(12.5)
    expect("override_unit_amount" in lines[0]).toBe(false)
  })

  it("carries the operator-typed weight", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 20 },
      weights: { var_1: 115 },
    })

    expect(lines[0].unit_weight_grams).toBe(115)
  })

  /**
   * 🔴 A blank DataGrid cell arrives as 0, and a 0 here is not "no answer": a
   * zero unit price asks the backend to mint an ACTIVE price of zero, and a
   * zero weight is a consignment every carrier rates at its floor (#1430).
   */
  it("drops a zero price, a zero weight and a zero discount as blanks", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 500 },
      overrides: { var_1: 0 },
      discounts: { var_1: 0 },
      weights: { var_1: 0 },
    })

    expect(lines[0]).toEqual({ variant_id: "var_1", quantity: 500, position: 0 })
  })

  it("leaves an untouched line exactly as it was", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 500 },
      overrides: {},
      discounts: {},
      design_by_variant: { var_1: "des_1" },
    })

    expect(lines[0]).toEqual({
      variant_id: "var_1",
      quantity: 500,
      position: 0,
      design_id: "des_1",
    })
  })

  it("drops variants with no quantity, and only those", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 0, var_2: 3 },
      overrides: { var_1: 900, var_2: 800 },
    })

    expect(lines.map((l) => l.variant_id)).toEqual(["var_2"])
    expect(lines[0].override_unit_amount).toBe(800)
  })

  /** A flat price and a percentage never travel together. */
  it("sends the flat price alone when both cells are filled", () => {
    const lines = draftLinesFromForm({
      quantities: { var_1: 10 },
      discounts: { var_1: 10 },
      overrides: { var_1: 900 },
    })

    expect(lines[0].override_unit_amount).toBe(900)
    expect("discount_percent" in lines[0]).toBe(false)
  })
})

describe("conflictingOverrides", () => {
  it("names the lines carrying both forms", () => {
    expect(
      conflictingOverrides({
        quantities: { var_1: 10, var_2: 10 },
        discounts: { var_1: 10, var_2: 10 },
        overrides: { var_1: 900 },
      })
    ).toEqual(["var_1"])
  })

  it("is silent when each line answers one way", () => {
    expect(
      conflictingOverrides({
        quantities: { var_1: 10, var_2: 10 },
        discounts: { var_2: 10 },
        overrides: { var_1: 900, var_2: 0 },
      })
    ).toEqual([])
  })
})

describe("basketFromDraftLines", () => {
  it("reads the stored trade price back into the grid's cells", () => {
    const basket = basketFromDraftLines([
      {
        variant_id: "var_1",
        quantity: 500,
        override_kind: "override_unit_amount",
        override_input_amount: 1200,
        quoted_unit_weight_grams: 115,
      },
      {
        variant_id: "var_2",
        quantity: 10,
        override_kind: "discount_percent",
        override_input_amount: 12.5,
      },
    ])

    expect(basket.overrides).toEqual({ var_1: 1200 })
    expect(basket.discounts).toEqual({ var_2: 12.5 })
    expect(basket.weights).toEqual({ var_1: 115 })
  })

  /**
   * 🔴 `Number(null)` is `0`. Coercing before the guard would read a typed zero
   * back onto every ordinary line — and the next save would send it.
   */
  it("leaves an ordinary line's cells empty rather than zero", () => {
    const basket = basketFromDraftLines([
      { variant_id: "var_1", quantity: 500, override_input_amount: null },
    ])

    expect(basket.discounts).toEqual({})
    expect(basket.overrides).toEqual({})
    expect(basket.weights).toEqual({})
  })

  /**
   * 🔴 Both steps read `product_ids` as `ids.map((p) => p.id)`. Hydrated as
   * bare strings that yields `undefined`, the selected set matches nothing, and
   * a saved draft reopens with an EMPTY quantities grid over a full basket —
   * no row to type a trade price onto.
   */
  it("hydrates product_ids as the { id } objects the steps read", () => {
    const basket = basketFromDraftLines([
      { variant_id: "var_1", product_id: "prod_1", quantity: 1 },
      { variant_id: "var_2", product_id: "prod_1", quantity: 1 },
      { variant_id: "var_3", product_id: "prod_2", quantity: 1 },
    ])

    expect(basket.product_ids).toEqual([{ id: "prod_1" }, { id: "prod_2" }])
    expect(basket.product_ids.map((p) => p.id)).toEqual(["prod_1", "prod_2"])
  })

  /** A bigNumber column can arrive as a string. */
  it("reads a stringified amount", () => {
    const basket = basketFromDraftLines([
      {
        variant_id: "var_1",
        quantity: 1,
        override_kind: "override_unit_amount",
        override_input_amount: "1200",
      },
    ])

    expect(basket.overrides).toEqual({ var_1: 1200 })
  })

  /**
   * 🔑 The round trip is the real assertion. Whatever the save sends, reopening
   * the modal must produce the same cells — a trip that loses a field is the
   * same silent discard wearing a different coat.
   */
  it("survives a round trip through the stored columns", () => {
    const values = {
      quantities: { var_1: 500, var_2: 10 },
      overrides: { var_1: 1200 },
      discounts: { var_2: 12.5 },
      weights: { var_1: 115 },
      design_by_variant: { var_2: "des_9" },
    }

    const stored = draftLinesFromForm(values).map((l) => ({
      variant_id: l.variant_id,
      quantity: l.quantity,
      design_id: l.design_id ?? null,
      override_kind:
        l.override_unit_amount !== undefined
          ? ("override_unit_amount" as const)
          : l.discount_percent !== undefined
            ? ("discount_percent" as const)
            : null,
      override_input_amount: l.override_unit_amount ?? l.discount_percent ?? null,
      quoted_unit_weight_grams: l.unit_weight_grams ?? null,
    }))

    const basket = basketFromDraftLines(stored)

    expect(basket.quantities).toEqual(values.quantities)
    expect(basket.overrides).toEqual(values.overrides)
    expect(basket.discounts).toEqual(values.discounts)
    expect(basket.weights).toEqual(values.weights)
    expect(basket.design_by_variant).toEqual(values.design_by_variant)
  })
})
