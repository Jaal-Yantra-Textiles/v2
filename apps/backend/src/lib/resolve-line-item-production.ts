// #1112 — shared traversal for resolving a retail order line item to its
// backing design (if any) and the idempotency guard both the payment
// (`order.placed`) and fulfillment (`order.fulfillment_created`) run-creation
// paths use. Keeping it in one place guarantees the two paths agree so they
// never double-create a run for the same line item.

import designOrderLineItemLink from "../links/design-order-line-item-link"

// Postgres unique_violation SQLSTATE — raised when the partial unique index on
// production_runs.order_line_item_id catches a concurrent double-create (#1123).
export const PLAN_UNIQUE_VIOLATION = "23505"

export type ResolvedLineItemDesign = {
  designId: string | null
  isCustomDesign: boolean
  /**
   * WHERE the answer came from. A caller that is about to write something
   * durable off this design — a production run, a payout, a re-point — needs
   * to know whether it is standing on a link it can move or on a string it
   * cannot.
   *
   *   · "link"     — the design_order_line_item link. Authoritative, movable.
   *   · "variant"  — design_product_variant. A custom design's own variant.
   *   · "product"  — product_design. The catalogue-level association.
   *   · "metadata" — `metadata.design_id`, provenance only. Means this item
   *                  predates the backfill, or the backfill missed it.
   *   · null       — nothing resolved.
   */
  source: "link" | "variant" | "product" | "metadata" | null
}

/**
 * Resolve the design linked to a line item — variant-level link (custom designs
 * from the design editor) takes priority over the product-level link.
 */
export async function resolveLineItemDesignId(
  query: any,
  {
    productId,
    variantId,
    lineItemId,
    metadata,
  }: {
    productId?: string | null
    variantId?: string | null
    /**
     * The ORDER line item's id. Without it a design-order item — which has
     * neither a product nor a variant — cannot be resolved at all, which is
     * how five paid-for designs on `order_01KNP520PT94BN8SC0JKZ6ZVJ9` reached
     * `order-placed.ts` and were skipped (#1918).
     */
    lineItemId?: string | null
    /** The item's `metadata`, for the provenance fallback. */
    metadata?: Record<string, any> | null
  }
): Promise<ResolvedLineItemDesign> {
  let designId: string | null = null
  let isCustomDesign = false

  /**
   * The link wins over everything, including `metadata.design_id`. After an
   * order edit re-points an item (#1921) the metadata still records what was
   * ORIGINALLY ordered — that is the point of keeping it — so reading it in
   * preference to the link would hand back the design the customer is no
   * longer getting.
   */
  if (lineItemId) {
    const { data: itemLinks } = await query.graph({
      entity: designOrderLineItemLink.entryPoint,
      fields: ["design_id"],
      filters: { order_line_item_id: lineItemId },
      pagination: { skip: 0, take: 1 },
    })
    const itemLink = (itemLinks || [])[0]
    if (itemLink?.design_id) {
      return {
        designId: itemLink.design_id,
        isCustomDesign: true,
        source: "link",
      }
    }
  }

  if (variantId) {
    const { data: variantDesignLinks } = await query.graph({
      entity: "design_product_variant",
      fields: ["design_id"],
      filters: { product_variant_id: variantId },
      pagination: { skip: 0, take: 1 },
    })
    const variantLink = (variantDesignLinks || [])[0]
    if (variantLink?.design_id) {
      return {
        designId: variantLink.design_id,
        isCustomDesign: true,
        source: "variant",
      }
    }
  }

  if (!designId && productId) {
    const { data: productDesignLinks } = await query.graph({
      entity: "product_design",
      fields: ["design.*"],
      filters: { product_id: productId },
      pagination: { skip: 0, take: 1 },
    })
    designId = (productDesignLinks || [])[0]?.design?.id || null
    if (designId) {
      return { designId, isCustomDesign, source: "product" }
    }
  }

  /**
   * Last: the string. Only fires for an item the backfill has not reached —
   * a design order placed before the link existed. Reported as "metadata" so
   * a caller can tell a real binding from a legacy one rather than treating
   * the two as interchangeable.
   */
  const fromMetadata = metadata?.design_id
  if (typeof fromMetadata === "string" && fromMetadata) {
    return { designId: fromMetadata, isCustomDesign: true, source: "metadata" }
  }

  return { designId: null, isCustomDesign: false, source: null }
}

/**
 * Idempotency guard shared by both run-creation paths: true when a production
 * run already exists for this line item (regardless of which path created it).
 */
export async function hasProductionRunForLineItem(
  query: any,
  lineItemId: string
): Promise<boolean> {
  return (await getProductionRunForLineItem(query, lineItemId)) !== null
}

export type LineItemProductionRun = {
  id: string
  status: string
  produced_quantity: number | null
  design_id: string | null
  metadata: Record<string, any> | null
}

/**
 * Like {@link hasProductionRunForLineItem} but returns the existing run's id +
 * status (and the fields the reconcile path needs) so the fulfillment path can
 * decide whether to complete it (still pre-production, i.e. shipped from stock)
 * vs leave it (production already underway, #1126), bump its produced quantity
 * on a later fulfillment, or soft-delete it on cancellation (#1123).
 */
export async function getProductionRunForLineItem(
  query: any,
  lineItemId: string
): Promise<LineItemProductionRun | null> {
  const { data: existing } = await query.graph({
    entity: "production_runs",
    fields: ["id", "status", "produced_quantity", "design_id", "metadata"],
    filters: { order_line_item_id: lineItemId },
    pagination: { skip: 0, take: 1 },
  })
  const run = (existing || [])[0]
  return run
    ? {
        id: run.id,
        status: run.status,
        produced_quantity: run.produced_quantity ?? null,
        design_id: run.design_id ?? null,
        metadata: run.metadata ?? null,
      }
    : null
}

/**
 * A provenance run this system minted from retail fulfillment (born terminal).
 * ONLY these are quantity-reconciled / soft-deleted by the fulfillment +
 * cancellation paths — a real production run (design work-order, or a run that
 * actually went through the shop) is never touched.
 *
 * Identified SOLELY by the create-side marker
 * `metadata.source === "order.fulfillment_created"`, which is written in exactly
 * one place (`reconcile-provenance-runs.ts`) and never by any path that mints a
 * real run. That marker alone is therefore sufficient.
 *
 * It previously ALSO required `design_id == null`, on the assumption that
 * provenance runs are product-only. They are not: the same creator mints
 * DESIGN-BACKED provenance runs whenever the fulfilled line resolves to a design
 * (it stamps `design_backed: true` alongside the marker). Those runs matched the
 * marker but failed the null check, so they were never adjusted when the
 * fulfilled quantity changed and — worse — were never soft-deleted when the
 * order was canceled, leaving a completed run claiming goods that never shipped.
 */
export function isOwnedProvenanceRun(
  run: Pick<LineItemProductionRun, "design_id" | "metadata"> | null | undefined
): boolean {
  if (!run) return false
  return run.metadata?.source === "order.fulfillment_created"
}
