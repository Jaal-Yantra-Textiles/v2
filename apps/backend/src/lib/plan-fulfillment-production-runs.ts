// #1112 / #1126 / #1122 — the single decision for "what should happen to a
// fulfilled retail line item's production run", shared by the live fulfillment
// subscriber (order.fulfillment_created) and the historical backfill job so the
// two can never drift or double-create against each other.
//
// Per fulfilled line item:
//   - no run yet            → CREATE a completed provenance run (design-backed
//                             or product-only), born terminal (goods shipped).
//   - run still pre-prod    → COMPLETE it (the order.placed run for a
//     (draft/pending_review)  design-backed line never went through production;
//                             the goods shipped from stock — #1126).
//   - run already producing → SKIP (real production; leave it alone).

import {
  getProductionRunForLineItem,
  resolveLineItemDesignId,
} from "./resolve-line-item-production"

// A run in one of these states means no production actually happened yet — on
// fulfillment that can only mean the goods shipped from stock.
export const PRE_PRODUCTION_STATUSES = new Set(["draft", "pending_review"])

export type PlannedRunAction =
  | {
      action: "create"
      line_item_id: string
      product_id: string
      variant_id?: string
      design_id: string | null
      is_custom_design: boolean
      quantity: number
    }
  | {
      action: "complete"
      line_item_id: string
      product_id: string
      production_run_id: string
      from_status: string
      quantity: number
    }

/**
 * Decide the provenance action for ONE fulfilled line item. Read-only (no
 * writes) — callers apply the returned action (create/complete workflow).
 * Returns null when there's nothing to do (no product, or a run already in
 * production/completed).
 */
export async function planLineItemRunAction(
  query: any,
  input: {
    lineItemId: string
    productId?: string | null
    variantId?: string | null
    quantity: number
  }
): Promise<PlannedRunAction | null> {
  const { lineItemId, productId, variantId, quantity } = input

  // No product to hang the run off → nothing to provenance.
  if (!productId) {
    return null
  }

  const existing = await getProductionRunForLineItem(query, lineItemId)
  if (existing) {
    if (PRE_PRODUCTION_STATUSES.has(existing.status)) {
      return {
        action: "complete",
        line_item_id: lineItemId,
        product_id: productId,
        production_run_id: existing.id,
        from_status: existing.status,
        quantity,
      }
    }
    // Already in production or completed — leave it untouched.
    return null
  }

  const { designId, isCustomDesign } = await resolveLineItemDesignId(query, {
    productId,
    variantId,
  })

  return {
    action: "create",
    line_item_id: lineItemId,
    product_id: productId,
    variant_id: variantId ?? undefined,
    design_id: designId ?? null,
    is_custom_design: isCustomDesign,
    quantity,
  }
}
