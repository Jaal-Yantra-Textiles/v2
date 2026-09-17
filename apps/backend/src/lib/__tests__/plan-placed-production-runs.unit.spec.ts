/**
 * `planPlacedLineItemRunAction` — #1923's lift, as an executable statement.
 *
 * The defect it exists to close: `order_01KNP520PT94BN8SC0JKZ6ZVJ9`, €335.39
 * captured 2026-04-08, four garments owed, `production_runs: []`. Every one of
 * its five items was a design line with no `product_id`, and the subscriber's
 * `if (!productId) continue` skipped all five. The same condition ALSO held
 * back the admin-converted design orders that must not produce — one guard
 * standing in for two opposite intentions.
 *
 * So the two halves are asserted separately here: a design-only line DOES
 * produce, and a vetoed line does NOT, for reasons that no longer share a
 * cause.
 */

import { planPlacedLineItemRunAction } from "../plan-placed-production-runs"

const LINK = "design_order_line_item"
const LINE = "ordli_1"
const PRODUCT = "prod_1"

/**
 * A query stub keyed on the query's SHAPE where it has to be.
 *
 * 🔴 `defineLink(...).entryPoint` is EMPTY at import time — the runtime fills
 * it when it loads links, which a unit test never does — so the per-item link
 * lookup arrives with `entity: ""`. A stub keyed on the link's NAME would
 * answer nothing, forever, and every test here would pass against a resolver
 * that never consulted the link.
 *
 * The `production_runs` lookup filters on `order_line_item_id` too, so entity
 * is checked FIRST; only an unnamed entity falls through to filter-shape.
 */
const makeQuery = (byKey: Record<string, any[]> = {}) => {
  const seen: string[] = []
  return {
    seen,
    graph: jest.fn(async ({ entity, filters }: any) => {
      const named = String(entity ?? "")
      const key = named
        ? named
        : filters?.order_line_item_id
          ? LINK
          : filters?.product_variant_id
            ? "design_product_variant"
            : filters?.product_id
              ? "product_design"
              : ""
      seen.push(key)
      return { data: byKey[key] ?? [] }
    }),
  }
}

describe("planPlacedLineItemRunAction", () => {
  describe("🔴 the #1923 lift — a design-only line produces", () => {
    it("creates a run for a line item with NO product and NO variant, resolved by its own link", async () => {
      // The shape of every item on order_01KNP520…: title-only, design bound
      // through the per-item link (#1919).
      const q = makeQuery({ [LINK]: [{ design_id: "des_paid" }] })

      const plan = await planPlacedLineItemRunAction(q, {
        lineItemId: LINE,
        productId: null,
        variantId: null,
        quantity: 4,
      })

      expect(plan).toEqual({
        action: "create",
        line_item_id: LINE,
        product_id: undefined,
        variant_id: undefined,
        design_id: "des_paid",
        is_custom_design: true,
        design_source: "link",
        quantity: 4,
      })
    })

    it("creates a run for a legacy design line the backfill never reached (metadata.design_id)", async () => {
      // Nothing linked anywhere — only the provenance string. Reported as
      // `metadata` so a caller can tell a real binding from a legacy one.
      const q = makeQuery()

      const plan = await planPlacedLineItemRunAction(q, {
        lineItemId: LINE,
        productId: null,
        quantity: 1,
        metadata: { design_id: "des_legacy" },
      })

      expect(plan).toMatchObject({
        action: "create",
        design_id: "des_legacy",
        design_source: "metadata",
        product_id: undefined,
      })
    })

    it("still produces for an ordinary product-backed design line", async () => {
      const q = makeQuery({ product_design: [{ design: { id: "des_cat" } }] })

      expect(
        await planPlacedLineItemRunAction(q, {
          lineItemId: LINE,
          productId: PRODUCT,
          variantId: "var_1",
          quantity: 2,
        })
      ).toMatchObject({
        action: "create",
        product_id: PRODUCT,
        variant_id: "var_1",
        design_id: "des_cat",
        design_source: "product",
        is_custom_design: false,
      })
    })
  })

  describe("what still holds a line back", () => {
    /**
     * The other half of the old guard, now written down. `convert-design-order`
     * stamps this on every item; without it, lifting the guard would make every
     * admin-converted customer design order auto-produce.
     */
    it("skips an explicitly vetoed line — and does not even look it up", async () => {
      const q = makeQuery({ [LINK]: [{ design_id: "des_x" }] })

      for (const raw of [true, "true"]) {
        expect(
          await planPlacedLineItemRunAction(q, {
            lineItemId: LINE,
            productId: null,
            quantity: 1,
            metadata: { no_auto_produce: raw },
          })
        ).toEqual({
          action: "skip",
          line_item_id: LINE,
          reason: "no_auto_produce",
        })
      }

      // The veto is decided before any query — a converted design order costs
      // nothing and cannot be produced by a resolver surprise.
      expect(q.graph).not.toHaveBeenCalled()
    })

    it("does not treat a falsy flag as a veto", async () => {
      const q = makeQuery({ [LINK]: [{ design_id: "des_x" }] })
      for (const raw of [false, "false", 0, "", null, undefined]) {
        expect(
          await planPlacedLineItemRunAction(q, {
            lineItemId: LINE,
            quantity: 1,
            metadata: { no_auto_produce: raw },
          })
        ).toMatchObject({ action: "create", design_id: "des_x" })
      }
    })

    it("skips a line that already has a run — idempotent across both doors", async () => {
      const q = makeQuery({
        production_runs: [{ id: "run_1", status: "pending_review" }],
        [LINK]: [{ design_id: "des_x" }],
      })

      expect(
        await planPlacedLineItemRunAction(q, {
          lineItemId: LINE,
          productId: null,
          quantity: 1,
        })
      ).toEqual({ action: "skip", line_item_id: LINE, reason: "run_exists" })
    })

    it("skips plain retail stock — a product with no design is not made to order", async () => {
      const q = makeQuery()

      expect(
        await planPlacedLineItemRunAction(q, {
          lineItemId: LINE,
          productId: PRODUCT,
          quantity: 1,
        })
      ).toEqual({ action: "skip", line_item_id: LINE, reason: "no_design" })
    })

    it("skips a title-only line that is not a design at all", async () => {
      // A manual adjustment line: no product, no variant, no link, no
      // metadata. Lifting the product guard must not start minting runs for
      // these.
      const q = makeQuery()

      expect(
        await planPlacedLineItemRunAction(q, { lineItemId: LINE, quantity: 1 })
      ).toEqual({ action: "skip", line_item_id: LINE, reason: "no_design" })
    })

    it("skips an item with no id, without touching the database", async () => {
      const q = makeQuery()
      expect(
        await planPlacedLineItemRunAction(q, { lineItemId: null, quantity: 1 })
      ).toEqual({ action: "skip", line_item_id: null, reason: "no_line_item" })
      expect(q.graph).not.toHaveBeenCalled()
    })
  })

  describe("precedence is preserved through the lift", () => {
    it("prefers the per-item link over metadata.design_id after a re-point", async () => {
      // #1921: the metadata still records what was ORIGINALLY ordered. Reading
      // it in preference to the link would produce the design the customer is
      // no longer getting.
      const q = makeQuery({ [LINK]: [{ design_id: "des_now" }] })

      expect(
        await planPlacedLineItemRunAction(q, {
          lineItemId: LINE,
          productId: null,
          quantity: 1,
          metadata: { design_id: "des_before" },
        })
      ).toMatchObject({ design_id: "des_now", design_source: "link" })
    })
  })
})
