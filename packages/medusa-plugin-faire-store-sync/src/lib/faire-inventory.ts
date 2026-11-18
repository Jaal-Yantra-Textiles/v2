import type { InventoryOverrideBySku } from "./types"

/**
 * Stock levels to push with `PATCH /product-inventory/by-skus` after a sync.
 *
 * - Nothing after a CREATE. The create payload already carries each variant's
 *   `available_quantity`, and Faire stores it. A push in the same breath 404s:
 *   right after create the new SKUs aren't addressable yet (Butterfly Shirt,
 *   2026-11-18 — the same push a minute later returned 200).
 * - Only variants with a real SKU. A variant without one is sent to Faire under
 *   its Medusa id (`variant_…` / `prod_…`), which is NOT a Faire SKU, so the
 *   push would 404 on it.
 */
export function inventoryLevelsToPush(
  variants: Array<{ sku?: string; available_quantity?: number }> | undefined,
  isCreate: boolean
): InventoryOverrideBySku[] {
  if (isCreate || !variants?.length) return []
  return variants
    .filter((v) => v.sku && !/^(prod|variant)_/.test(v.sku))
    .map((v) => ({
      sku: v.sku as string,
      on_hand_quantity: v.available_quantity ?? 0,
    }))
}
