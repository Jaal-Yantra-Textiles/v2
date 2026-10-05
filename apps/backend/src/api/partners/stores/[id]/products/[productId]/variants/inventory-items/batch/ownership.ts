/**
 * PURE: why a partner may not apply this kit batch, or null when it may.
 * Split from the route so each rule can be tested without a database.
 */
export type KitBatchOwnershipInput = {
  product: { variantIds: string[]; salesChannelIds: string[] } | null
  storeSalesChannelId?: string | null
  storeLocationIds: string[]
  items: Array<{ id: string; locationIds: string[] }>
  rows: Array<{ variant_id: string; inventory_item_id: string }>
}

export const findKitBatchOwnershipProblem = ({
  product,
  storeSalesChannelId,
  storeLocationIds,
  items,
  rows,
}: KitBatchOwnershipInput): string | null => {
  if (
    !product ||
    !storeSalesChannelId ||
    !product.salesChannelIds.includes(storeSalesChannelId)
  ) {
    return "Product not found"
  }

  const variants = new Set(product.variantIds)
  const strayVariant = rows.find((r) => !variants.has(r.variant_id))
  if (strayVariant) {
    return `Variant ${strayVariant.variant_id} not found on this product`
  }

  const locations = new Set(storeLocationIds)
  const stocked = new Set(
    items.filter((i) => i.locationIds.some((l) => locations.has(l))).map((i) => i.id)
  )
  const strayItem = rows.find((r) => !stocked.has(r.inventory_item_id))
  if (strayItem) {
    return `Inventory item ${strayItem.inventory_item_id} not found`
  }

  return null
}
