// #1112 / #1126 / #1122 — the single decision for "what should happen to a
// fulfilled retail line item's production run", shared by the live fulfillment
// subscriber (order.fulfillment_created) and the historical backfill job so the
// two can never drift or double-create against each other.
//
// Per fulfilled line item:
//   - no run yet            → CREATE a completed provenance run (design-backed,
//                             product-only, or design-ONLY since #1923), born
//                             terminal (goods shipped),
//                             UNLESS the item carries #1920's explicit
//                             `no_auto_produce` veto.
//   - run still pre-prod    → COMPLETE it (the order.placed run for a
//     (draft/pending_review)  design-backed line never went through production;
//                             the goods shipped from stock — #1126).
//   - run already producing → SKIP (real production; leave it alone).

import {
  getProductionRunForLineItem,
  isAutoProduceSuppressed,
  resolveLineItemDesignId,
} from "./resolve-line-item-production"

// A run in one of these states means no production actually happened yet — on
// fulfillment that can only mean the goods shipped from stock.
export const PRE_PRODUCTION_STATUSES = new Set(["draft", "pending_review"])

export type PlannedRunAction =
  | {
      action: "create"
      line_item_id: string
      /**
       * Absent on a design-only line (#1923). A run needs SOMETHING to hang
       * off — a product or a design — but no longer specifically a product.
       */
      product_id?: string
      variant_id?: string
      design_id: string | null
      is_custom_design: boolean
      quantity: number
    }
  | {
      action: "complete"
      line_item_id: string
      product_id?: string
      production_run_id: string
      from_status: string
      quantity: number
    }

/**
 * Decide the provenance action for ONE fulfilled line item. Read-only (no
 * writes) — callers apply the returned action (create/complete workflow).
 * Returns null when there's nothing to do (a run already in
 * production/completed, or a line that is neither product- nor design-backed).
 */
export async function planLineItemRunAction(
  query: any,
  input: {
    lineItemId: string
    productId?: string | null
    variantId?: string | null
    quantity: number
    /** The item's metadata, for the #1919 provenance fallback. Optional: a
     *  caller that does not have it simply loses that last resort. */
    metadata?: Record<string, any> | null
  }
): Promise<PlannedRunAction | null> {
  const { lineItemId, productId, variantId, quantity, metadata } = input

  /**
   * 🔴 #1923 — there used to be a `if (!productId) return null` here, and it
   * ran BEFORE the existing-run lookup below. Once `order.placed` started
   * minting runs for design-only lines, that guard meant such a run could
   * never be COMPLETED on fulfillment: it would sit at `pending_review`
   * forever while the goods were on a truck. The "nothing to hang a run off"
   * check still exists — it just moved below the design resolution, where it
   * can tell a line with no product from a line with nothing at all.
   */
  const existing = await getProductionRunForLineItem(query, lineItemId)
  if (existing) {
    if (PRE_PRODUCTION_STATUSES.has(existing.status)) {
      return {
        action: "complete",
        line_item_id: lineItemId,
        product_id: productId ?? undefined,
        production_run_id: existing.id,
        from_status: existing.status,
        quantity,
      }
    }
    // Already in production or completed — leave it untouched.
    return null
  }

  /**
   * #1920 — an explicit no-auto-produce veto blocks CREATION only, and only
   * here at the automatic door. It is checked AFTER the existing-run branch on
   * purpose: completing a run that an admin already created explicitly is not
   * auto-production, and a shipped design order should still close its run.
   */
  if (isAutoProduceSuppressed(metadata)) {
    return null
  }

  const { designId, isCustomDesign } = await resolveLineItemDesignId(query, {
    productId,
    variantId,
    lineItemId,
    metadata,
  })

  /**
   * Nothing to hang a run off: no product spine AND no design. A title-only
   * line that is not a design (a manual adjustment, a legacy custom line) gets
   * no provenance run — the same answer the old `!productId` guard gave, now
   * asked of both spines instead of one.
   */
  if (!productId && !designId) {
    return null
  }

  return {
    action: "create",
    line_item_id: lineItemId,
    product_id: productId ?? undefined,
    variant_id: variantId ?? undefined,
    design_id: designId ?? null,
    is_custom_design: isCustomDesign,
    quantity,
  }
}
