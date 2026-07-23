// #1112 — shared traversal for resolving a retail order line item to its
// backing design (if any) and the idempotency guard both the payment
// (`order.placed`) and fulfillment (`order.fulfillment_created`) run-creation
// paths use. Keeping it in one place guarantees the two paths agree so they
// never double-create a run for the same line item.

// Postgres unique_violation SQLSTATE — raised when the partial unique index on
// production_runs.order_line_item_id catches a concurrent double-create (#1123).
export const PLAN_UNIQUE_VIOLATION = "23505"

export type ResolvedLineItemDesign = {
  designId: string | null
  isCustomDesign: boolean
}

/**
 * Resolve the design linked to a line item — variant-level link (custom designs
 * from the design editor) takes priority over the product-level link.
 */
export async function resolveLineItemDesignId(
  query: any,
  { productId, variantId }: { productId?: string | null; variantId?: string | null }
): Promise<ResolvedLineItemDesign> {
  let designId: string | null = null
  let isCustomDesign = false

  if (variantId) {
    const { data: variantDesignLinks } = await query.graph({
      entity: "design_product_variant",
      fields: ["design_id"],
      filters: { product_variant_id: variantId },
      pagination: { skip: 0, take: 1 },
    })
    const variantLink = (variantDesignLinks || [])[0]
    if (variantLink?.design_id) {
      designId = variantLink.design_id
      isCustomDesign = true
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
  }

  return { designId, isCustomDesign }
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
 * A provenance run this system minted from retail fulfillment (product-only,
 * born terminal). ONLY these are quantity-reconciled / soft-deleted by the
 * fulfillment + cancellation paths — a real production run (design work-order,
 * or a run that actually went through the shop) is never touched. Identified by
 * the create-side marker `metadata.source === "order.fulfillment_created"` and
 * the absence of a backing design.
 */
export function isOwnedProvenanceRun(
  run: Pick<LineItemProductionRun, "design_id" | "metadata"> | null | undefined
): boolean {
  if (!run) return false
  return (
    run.design_id == null &&
    run.metadata?.source === "order.fulfillment_created"
  )
}
