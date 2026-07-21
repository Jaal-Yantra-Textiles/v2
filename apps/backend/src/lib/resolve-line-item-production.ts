// #1112 — shared traversal for resolving a retail order line item to its
// backing design (if any) and the idempotency guard both the payment
// (`order.placed`) and fulfillment (`order.fulfillment_created`) run-creation
// paths use. Keeping it in one place guarantees the two paths agree so they
// never double-create a run for the same line item.

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
  const { data: existing } = await query.graph({
    entity: "production_runs",
    fields: ["id"],
    filters: { order_line_item_id: lineItemId },
    pagination: { skip: 0, take: 1 },
  })
  return (existing || []).length > 0
}
