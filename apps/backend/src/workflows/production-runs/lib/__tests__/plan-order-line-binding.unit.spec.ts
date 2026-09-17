/**
 * #1970 item 2 — approval binds the paid line to the approved variant.
 *
 * The defect: `applyRunApprovals` had `order_id`, `order_line_item_id` and
 * `produced_quantity` in hand the whole time and threw all three away. Grepping
 * `approve-run-output.ts` for `order_line_item_id` returned nothing. A customer
 * paid, the garment was made, the run was approved — and the paid line kept
 * `variant_id: null`, so nothing could ever fulfil it.
 *
 * 🔴 The invariant these tests exist to protect is NOT "a variant gets bound".
 * It is that binding one does not RE-PRICE a captured order. The paid line's
 * price is what the customer was quoted at checkout; the approval price is run
 * cost × markup, a different number. The last describe block is the one that
 * matters.
 */

import {
  BINDABLE_LINE_FIELDS,
  buildLineBindingPayload,
  planOrderLineBindings,
} from "../plan-order-line-binding"

const RUN = "prod_run_1"
const LINE = "ordli_1"
const ORDER = "order_1"
const VARIANT = "variant_1"
const PRODUCT = "prod_1"

const run = (over: Record<string, any> = {}) => ({
  id: RUN,
  order_id: ORDER,
  order_line_item_id: LINE,
  approved_variant_id: VARIANT,
  approved_product_id: PRODUCT,
  produced_quantity: 1,
  ...over,
})

const lines = (...rows: Array<{ id: string; variant_id?: string | null }>) =>
  new Map(rows.map((r) => [r.id, r]))

describe("planOrderLineBindings", () => {
  it("binds a paid line that has no variant — the whole point of #1970", () => {
    const plan = planOrderLineBindings([run()], lines({ id: LINE, variant_id: null }))

    expect(plan.bind).toEqual([
      {
        run_id: RUN,
        line_item_id: LINE,
        order_id: ORDER,
        variant_id: VARIANT,
        product_id: PRODUCT,
        produced_quantity: 1,
      },
    ])
    expect(plan.skip).toEqual([])
  })

  describe("what it refuses to touch", () => {
    /**
     * 🔴 The expensive one. A line that already has a variant is either an
     * ordinary catalogue purchase or a line another design's approval answered
     * for. Re-pointing it would move a customer's paid garment onto a different
     * variant, silently.
     */
    it("NEVER overwrites a variant that is already there", () => {
      const plan = planOrderLineBindings(
        [run()],
        lines({ id: LINE, variant_id: "someone_elses_variant" })
      )

      expect(plan.bind).toEqual([])
      expect(plan.skip).toEqual([
        { run_id: RUN, line_item_id: LINE, reason: "already_bound" },
      ])
    })

    /**
     * `resolveDesignApprovalTarget` refuses with a null variant when two runs of
     * one design made different garments. A refusal is an answer; binding to
     * "whatever is nearby" is the `products[0].variants[0]` mistake it exists
     * to prevent.
     */
    it("does not guess a variant when approval could not name one", () => {
      const plan = planOrderLineBindings(
        [run({ approved_variant_id: null })],
        lines({ id: LINE, variant_id: null })
      )
      expect(plan.bind).toEqual([])
      expect(plan.skip[0]).toMatchObject({ reason: "no_variant" })
    })

    it("treats a run with no order line as ordinary, not as a failure", () => {
      // A design work-order with no customer behind it has no loop to close.
      const plan = planOrderLineBindings(
        [run({ order_line_item_id: null })],
        lines()
      )
      expect(plan.bind).toEqual([])
      expect(plan.skip[0]).toMatchObject({
        reason: "no_order_line",
        line_item_id: null,
      })
    })

    it("does not assume a line exists just because a run names it", () => {
      // The order can be canceled between the approval and this read.
      const plan = planOrderLineBindings([run()], lines())
      expect(plan.bind).toEqual([])
      expect(plan.skip[0]).toMatchObject({ reason: "line_missing" })
    })
  })

  it("decides each run on its own terms across a batch", () => {
    const plan = planOrderLineBindings(
      [
        run({ id: "r_bind", order_line_item_id: "l_free" }),
        run({ id: "r_taken", order_line_item_id: "l_taken" }),
        run({ id: "r_novariant", order_line_item_id: "l_free2", approved_variant_id: null }),
        run({ id: "r_noline", order_line_item_id: null }),
      ],
      lines(
        { id: "l_free", variant_id: null },
        { id: "l_taken", variant_id: "other" },
        { id: "l_free2", variant_id: null }
      )
    )

    expect(plan.bind.map((b) => b.run_id)).toEqual(["r_bind"])
    expect(plan.skip.map((s) => s.reason)).toEqual([
      "already_bound",
      "no_variant",
      "no_order_line",
    ])
  })

  it("carries produced_quantity through for the fulfilment half", () => {
    const plan = planOrderLineBindings(
      [run({ produced_quantity: 3 })],
      lines({ id: LINE, variant_id: null })
    )
    expect(plan.bind[0].produced_quantity).toBe(3)

    // Absent is null, not 0 — `0` produced and "we don't know" are different
    // claims, and a 0 here would read as "nothing was made".
    const unknown = planOrderLineBindings(
      [run({ produced_quantity: undefined })],
      lines({ id: LINE, variant_id: null })
    )
    expect(unknown.bind[0].produced_quantity).toBeNull()
  })

  /**
   * 🔴🔴 THE MONEY INVARIANT.
   *
   * The paid line's `unit_price` is the cost estimate quoted to that customer at
   * checkout. The approval price is `computeRunCostSummary`'s `cost_per_unit` ×
   * the approval markup — a different number. If a binding ever carried a price
   * field, approving a run would silently re-charge a captured order.
   *
   * Asserted on the payload builder itself rather than on a call site, so the
   * rule survives someone editing the call site.
   */
  describe("🔴 the payload cannot reprice a captured order", () => {
    it("carries no price field of any kind", () => {
      const payload = buildLineBindingPayload(
        { run_id: RUN, line_item_id: LINE, order_id: ORDER, variant_id: VARIANT, product_id: PRODUCT, produced_quantity: 1 },
        { sku: "SKU-1", title: "M / Indigo", product: { title: "Kashmiri Shawl" } }
      )

      for (const forbidden of [
        "unit_price",
        "price",
        "total",
        "subtotal",
        "raw_unit_price",
        "is_custom_price",
        "compare_at_unit_price",
        "quantity",
      ]) {
        expect(payload).not.toHaveProperty(forbidden)
      }
    })

    it("writes only the fields declared bindable", () => {
      const payload = buildLineBindingPayload(
        { run_id: RUN, line_item_id: LINE, order_id: ORDER, variant_id: VARIANT, product_id: PRODUCT, produced_quantity: 1 },
        { sku: "SKU-1", title: "M / Indigo", product: { title: "Kashmiri Shawl" } }
      )

      expect(Object.keys(payload).sort()).toEqual([...BINDABLE_LINE_FIELDS].sort())
      expect(payload).toEqual({
        variant_id: VARIANT,
        product_id: PRODUCT,
        variant_sku: "SKU-1",
        variant_title: "M / Indigo",
        product_title: "Kashmiri Shawl",
      })
    })

    it("still binds the variant when the cosmetic details are unavailable", () => {
      // The binding IS the variant_id; sku/title are decoration. A failed
      // variant read must not cost the loop closure.
      const payload = buildLineBindingPayload(
        { run_id: RUN, line_item_id: LINE, order_id: ORDER, variant_id: VARIANT, product_id: null, produced_quantity: null },
        null
      )
      expect(payload).toEqual({ variant_id: VARIANT })
    })
  })
})
