// #1923 — the single decision for "should PLACING this order create a
// production run for this line item".
//
// It used to live as a 40-line branch inside `order-placed.ts`, which is why
// nothing asserted it and why the guard at its centre went wrong so quietly.
// This is the placement-side twin of `planLineItemRunAction`
// (`plan-fulfillment-production-runs.ts`); keeping the two as sibling planners
// is what stops the two doors from drifting apart again.
//
// Per placed line item:
//   - explicit #1920 veto        → SKIP (an admin-converted design order
//                                  produces only when an admin says so)
//   - a run already bound        → SKIP (idempotent; either door may have run)
//   - no design resolvable       → SKIP (retail stock, nothing to make)
//   - otherwise                  → CREATE, product-backed or design-only
//
// 🔴 THE LIFT (#1923). There used to be a `if (!productId) continue` above the
// design resolution. It was never a decision — it was the ACCIDENT that a
// design-order line item carries no `product_id`, standing in for two opposite
// intentions at once (see `NO_AUTO_PRODUCE_METADATA_KEY`). It suppressed the
// converted design orders that must not produce, and it equally suppressed the
// five paid-for design items on `order_01KNP520PT94BN8SC0JKZ6ZVJ9` — €335.39
// captured, four garments owed, `production_runs: []`. Now that #1920 writes
// the veto down and #1919 makes a design-order item resolvable by its own line
// link, the guard is gone and only the veto holds anything back.

import {
  hasProductionRunForLineItem,
  isAutoProduceSuppressed,
  resolveLineItemDesignId,
  type ResolvedLineItemDesign,
} from "./resolve-line-item-production"

export type PlacedRunPlan =
  | {
      action: "create"
      line_item_id: string
      /** Absent on a design-only line — that is the whole point of #1923. */
      product_id?: string
      variant_id?: string
      design_id: string
      is_custom_design: boolean
      /** WHERE the design came from, so the caller can log a link apart from
       *  a legacy `metadata.design_id` string rather than treating them alike. */
      design_source: ResolvedLineItemDesign["source"]
      quantity: number
    }
  | {
      action: "skip"
      line_item_id: string | null
      reason: "no_line_item" | "no_auto_produce" | "run_exists" | "no_design"
    }

/**
 * Decide the placement action for ONE order line item. Read-only (no writes) —
 * the caller applies the plan.
 */
export async function planPlacedLineItemRunAction(
  query: any,
  input: {
    lineItemId?: string | null
    productId?: string | null
    variantId?: string | null
    quantity: number
    metadata?: Record<string, any> | null
  }
): Promise<PlacedRunPlan> {
  const { lineItemId, productId, variantId, quantity, metadata } = input

  if (!lineItemId) {
    return { action: "skip", line_item_id: null, reason: "no_line_item" }
  }

  /**
   * #1920 — the EXPLICIT veto, checked first and on its own terms.
   * `convert-design-order` stamps it on every item of an admin-converted
   * design order; producing one of those is an explicit admin step
   * (`createRunsForDesignOrder`), never a side-effect of placement.
   *
   * Deliberately independent of `productId`: with the guard below lifted, this
   * flag is the ONLY thing still holding the converted orders back.
   */
  if (isAutoProduceSuppressed(metadata)) {
    return { action: "skip", line_item_id: lineItemId, reason: "no_auto_produce" }
  }

  // Idempotency, shared with the fulfillment door so neither double-creates.
  if (await hasProductionRunForLineItem(query, lineItemId)) {
    return { action: "skip", line_item_id: lineItemId, reason: "run_exists" }
  }

  /**
   * Resolve the design. The per-item LINK wins over the variant- and
   * product-level associations (#1919), so an item re-pointed by an order edit
   * resolves to what it is for NOW rather than to whatever its variant happens
   * to be attached to. A design-order line has neither product nor variant and
   * is resolvable ONLY through that link (or, for rows the backfill never
   * reached, through `metadata.design_id`).
   */
  const { designId, isCustomDesign, source } = await resolveLineItemDesignId(
    query,
    { productId, variantId, lineItemId, metadata }
  )

  if (!designId) {
    return { action: "skip", line_item_id: lineItemId, reason: "no_design" }
  }

  return {
    action: "create",
    line_item_id: lineItemId,
    product_id: productId ?? undefined,
    variant_id: variantId ?? undefined,
    design_id: designId,
    is_custom_design: isCustomDesign,
    design_source: source,
    quantity,
  }
}
