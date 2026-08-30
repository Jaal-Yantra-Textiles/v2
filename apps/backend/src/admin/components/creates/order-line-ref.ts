/**
 * #1662 — how a picked catalog row becomes an order-line reference.
 *
 * The picker holds ONE value per row, but the catalog has two kinds of row:
 * an inventory item that exists, and a product variant that has none yet
 * (a partner's fabric or finished good, which core never gave an inventory
 * item). The untracked rows carry a deliberately synthetic id so the two can
 * never be confused — and this is the ONLY place that reads it. The API is
 * sent `variant_id`, never the synthetic string, so the server-side contract
 * stays two named fields rather than one overloaded one.
 */
export const UNTRACKED_VARIANT_PREFIX = "untracked_variant:"

export const isUntrackedVariantRef = (value?: string | null): boolean =>
  typeof value === "string" && value.startsWith(UNTRACKED_VARIANT_PREFIX)

export const variantIdFromRef = (value?: string | null): string | null =>
  isUntrackedVariantRef(value)
    ? (value as string).slice(UNTRACKED_VARIANT_PREFIX.length) || null
    : null

/**
 * Split one picked value into the field the API expects. Exactly one of the
 * two keys is present, matching the validator's either/or rule.
 */
export const toOrderLineRef = (
  value?: string | null
): { inventory_item_id: string } | { variant_id: string } | null => {
  if (!value) {
    return null
  }
  const variantId = variantIdFromRef(value)
  if (variantId) {
    return { variant_id: variantId }
  }
  return { inventory_item_id: value }
}
