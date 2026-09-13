/**
 * `planLineItemRunAction` — what happens to a fulfilled retail line's
 * production run. It had NO tests, and it is the function that decides whether
 * a provenance run is minted, an existing one is completed, or nothing happens.
 *
 * Written after the 2026-09-13 Sharlho audit (#2030 item 1), where it minted a
 * duplicate run for a garment that had already been made and recorded. The last
 * describe block below encodes that shape exactly, so the next reader meets it
 * as an executable statement rather than as five completed runs and a mystery.
 */

import {
  planLineItemRunAction,
  PRE_PRODUCTION_STATUSES,
} from "../plan-fulfillment-production-runs"

/**
 * A `query.graph` stub that answers per entity.
 *
 * `production_runs` is the only entity this function's own logic reads; the
 * rest are the design resolver's, defaulted to empty so a test that does not
 * care about design attribution says nothing about it.
 */
const makeQuery = (byEntity: Record<string, any[]> = {}) => ({
  graph: jest.fn(async ({ entity }: any) => ({
    data: byEntity[entity] ?? [],
  })),
})

const LINE = "ordli_1"
const PRODUCT = "prod_1"

describe("planLineItemRunAction", () => {
  it("does nothing without a product — there is nothing to hang a run off", async () => {
    const q = makeQuery()
    expect(
      await planLineItemRunAction(q, { lineItemId: LINE, productId: null, quantity: 1 })
    ).toBeNull()
    // And it does not even look.
    expect(q.graph).not.toHaveBeenCalled()
  })

  describe("a run already bound to this line", () => {
    it.each([...PRE_PRODUCTION_STATUSES])(
      "completes a %s run — the goods shipped from stock, no shop-floor work happened",
      async (status) => {
        const q = makeQuery({
          production_runs: [{ id: "run_1", status, design_id: "des_1" }],
        })
        expect(
          await planLineItemRunAction(q, {
            lineItemId: LINE,
            productId: PRODUCT,
            quantity: 3,
          })
        ).toEqual({
          action: "complete",
          line_item_id: LINE,
          product_id: PRODUCT,
          production_run_id: "run_1",
          from_status: status,
          quantity: 3,
        })
      }
    )

    it.each(["in_progress", "completed", "cancelled"])(
      "leaves a %s run alone — that is real production",
      async (status) => {
        const q = makeQuery({
          production_runs: [{ id: "run_1", status, design_id: "des_1" }],
        })
        expect(
          await planLineItemRunAction(q, {
            lineItemId: LINE,
            productId: PRODUCT,
            quantity: 1,
          })
        ).toBeNull()
      }
    )

    /**
     * #1920's veto is checked AFTER this branch on purpose: completing a run an
     * admin created explicitly is not auto-production, and a shipped design
     * order should still close its run. Pinned because the ordering is the
     * decision, and it reads as an accident.
     */
    it("still completes a pre-production run even when auto-produce is vetoed", async () => {
      const q = makeQuery({
        production_runs: [{ id: "run_1", status: "draft", design_id: "des_1" }],
      })
      const plan = await planLineItemRunAction(q, {
        lineItemId: LINE,
        productId: PRODUCT,
        quantity: 1,
        metadata: { no_auto_produce: true },
      })
      expect(plan).toMatchObject({ action: "complete", production_run_id: "run_1" })
    })
  })

  describe("no run bound to this line", () => {
    it("creates a provenance run", async () => {
      const q = makeQuery()
      expect(
        await planLineItemRunAction(q, {
          lineItemId: LINE,
          productId: PRODUCT,
          variantId: "var_1",
          quantity: 2,
        })
      ).toEqual({
        action: "create",
        line_item_id: LINE,
        product_id: PRODUCT,
        variant_id: "var_1",
        design_id: null,
        is_custom_design: false,
        quantity: 2,
      })
    })

    it("respects the #1920 no-auto-produce veto", async () => {
      const q = makeQuery()
      for (const raw of [true, "true"]) {
        expect(
          await planLineItemRunAction(q, {
            lineItemId: LINE,
            productId: PRODUCT,
            quantity: 1,
            metadata: { no_auto_produce: raw },
          })
        ).toBeNull()
      }
      // Anything else is not a veto — the flag is explicit or absent.
      expect(
        await planLineItemRunAction(q, {
          lineItemId: LINE,
          productId: PRODUCT,
          quantity: 1,
          metadata: { no_auto_produce: false },
        })
      ).toMatchObject({ action: "create" })
    })
  })

  /**
   * 🔴 THE SHARLHO SHAPE (#2030 item 1).
   *
   * Five runs existed for one design and TWO garments. Four of them did the real
   * work — and every one carried `order_line_item_id: null`, because a run is
   * bound to a line only at CREATION and these were created before the line
   * existed (see `getProductionRunForLineItem`, which measured 0 of 53 children
   * and 0 of 52 parents carrying one).
   *
   * So the lookup below found nothing, and this function did what it is told to:
   * it planned a CREATE. The result was `prod_run_01M25T03…` — born `completed`,
   * `produced_quantity: 1`, every lifecycle timestamp null, zero activity rows —
   * recording a second time the very jacket a `produced 1 → 2` correction had
   * just accounted for.
   *
   * These tests assert the CURRENT behaviour deliberately. The planner is not
   * wrong; it is blind, and the blindness is the #1918 line-item binding hole.
   * If binding is ever fixed, the first of these goes red and that is the signal
   * to delete it — not a regression.
   */
  describe("🔴 mints a duplicate when the real runs are not bound to the line", () => {
    it("creates, although the design already has completed runs", async () => {
      // Runs for the design exist and are completed — but none is bound to THIS
      // line, so the lookup (which filters on `order_line_item_id`) sees none.
      const q = makeQuery({ production_runs: [] })

      const plan = await planLineItemRunAction(q, {
        lineItemId: "ordli_01M25NAT0B8VQCDSD0XWGFHM0A",
        productId: "prod_01M25K1PBS7XY53REAW6KVX8AW",
        variantId: "variant_01M25K1PG06AAVWZFVW67CD051",
        quantity: 1,
      })

      expect(plan).toMatchObject({ action: "create", quantity: 1 })

      // And the lookup really did filter on the line item — that filter is the
      // whole reason it cannot see the runs that did the work.
      const runQuery = q.graph.mock.calls
        .map(([arg]: any[]) => arg)
        .find((a: any) => a.entity === "production_runs")
      expect(runQuery.filters).toEqual({
        order_line_item_id: "ordli_01M25NAT0B8VQCDSD0XWGFHM0A",
      })
    })

    /**
     * The one thing that WOULD have stopped it. A run bound to the line is seen
     * and left alone — so the fix for the phantom is binding, not a new guard
     * inside the planner.
     */
    it("does not create once a completed run IS bound to the line", async () => {
      const q = makeQuery({
        production_runs: [
          { id: "prod_run_real", status: "completed", design_id: "des_1" },
        ],
      })
      expect(
        await planLineItemRunAction(q, {
          lineItemId: "ordli_01M25NAT0B8VQCDSD0XWGFHM0A",
          productId: "prod_01M25K1PBS7XY53REAW6KVX8AW",
          quantity: 1,
        })
      ).toBeNull()
    })
  })
})
