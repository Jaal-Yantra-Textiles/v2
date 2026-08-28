import { resolveSubmissionSource } from "../lib/submission-source"

/**
 * Where a payout's money came from, folded from its lines.
 *
 * Context: `payment_reconciliation.reference_type` has offered an
 * `inventory_order` value since the model was written, but the only writer
 * hardcoded `"payment_submission"` — so all four rows on prod say the same
 * thing and the distinction has never once been expressed.
 */
describe("resolveSubmissionSource", () => {
  it("reads a single design-sourced submission", () => {
    expect(
      resolveSubmissionSource([{ source_type: "design", design_id: "design_1" }])
    ).toEqual({ source_type: "design", source_id: "design_1" })
  })

  it("reads an inventory-order submission — the case that drove this", () => {
    expect(
      resolveSubmissionSource([
        { source_type: "inventory_order", inventory_order_id: "inv_order_1" },
      ])
    ).toEqual({ source_type: "inventory_order", source_id: "inv_order_1" })
  })

  /**
   * A run-sourced line resolves to its ORDER, not to a run. The line groups
   * runs on purpose — order #79's seven runs are ONE payout of ₹8,974, not
   * seven of ₹1,282 — so the order is what the money is for.
   */
  it("resolves a run line to its order, not to one of its runs", () => {
    expect(
      resolveSubmissionSource([
        {
          source_type: "run",
          order_id: "order_79",
          production_run_ids: ["run_a", "run_b", "run_c"],
        },
      ])
    ).toEqual({ source_type: "run", source_id: "order_79" })
  })

  it("gives a run line with no order a type but no id", () => {
    expect(
      resolveSubmissionSource([
        { source_type: "run", production_run_ids: ["run_a"] },
      ])
    ).toEqual({ source_type: "run", source_id: null })
  })

  describe("more than one source", () => {
    /**
     * 🔴 Mixed is a real shape, not a failure. Reporting whichever line came
     * first would assert something untrue about every other line — the same
     * defect as a column that means different things on different rows.
     */
    it("reports mixed rather than picking the first line's type", () => {
      expect(
        resolveSubmissionSource([
          { source_type: "design", design_id: "design_1" },
          { source_type: "inventory_order", inventory_order_id: "inv_order_1" },
        ])
      ).toEqual({ source_type: "mixed", source_id: null })
    })

    /**
     * One TYPE but several ids is not mixed — and still has no single id. A
     * column holding the first of three orders would be read as "this payout
     * is for that order", which is false.
     */
    it("keeps the type but drops the id when one type names several ids", () => {
      expect(
        resolveSubmissionSource([
          { source_type: "inventory_order", inventory_order_id: "inv_order_1" },
          { source_type: "inventory_order", inventory_order_id: "inv_order_2" },
        ])
      ).toEqual({ source_type: "inventory_order", source_id: null })
    })

    it("collapses several lines naming the SAME id to that id", () => {
      expect(
        resolveSubmissionSource([
          { source_type: "run", order_id: "order_79", production_run_ids: ["a"] },
          { source_type: "run", order_id: "order_79", production_run_ids: ["b"] },
        ])
      ).toEqual({ source_type: "run", source_id: "order_79" })
    })
  })

  describe("lines written before source_type existed (#1614)", () => {
    /**
     * ⚠️ A missing source_type is NOT design. Only the ids can say what an
     * older row is, and guessing would mislabel every legacy payout.
     */
    it("infers inventory_order from the id alone", () => {
      expect(
        resolveSubmissionSource([{ inventory_order_id: "inv_order_1" }])
      ).toEqual({ source_type: "inventory_order", source_id: "inv_order_1" })
    })

    it("infers run from production_run_ids alone", () => {
      expect(
        resolveSubmissionSource([
          { production_run_ids: ["run_a"], order_id: "order_79" },
        ])
      ).toEqual({ source_type: "run", source_id: "order_79" })
    })

    it("infers design from design_id alone", () => {
      expect(resolveSubmissionSource([{ design_id: "design_1" }])).toEqual({
        source_type: "design",
        source_id: "design_1",
      })
    })
  })

  describe("nothing to go on", () => {
    it("returns nulls for no lines rather than inventing a source", () => {
      expect(resolveSubmissionSource([])).toEqual({
        source_type: null,
        source_id: null,
      })
    })

    it("returns nulls for null/undefined", () => {
      expect(resolveSubmissionSource(null)).toEqual({
        source_type: null,
        source_id: null,
      })
      expect(resolveSubmissionSource(undefined)).toEqual({
        source_type: null,
        source_id: null,
      })
    })

    it("ignores a line carrying no ids at all", () => {
      expect(resolveSubmissionSource([{}])).toEqual({
        source_type: null,
        source_id: null,
      })
    })

    /** An unattributable line must not drag a real one into `mixed`. */
    it("ignores an empty line alongside a real one", () => {
      expect(
        resolveSubmissionSource([
          {},
          { source_type: "inventory_order", inventory_order_id: "inv_order_1" },
        ])
      ).toEqual({ source_type: "inventory_order", source_id: "inv_order_1" })
    })
  })
})
