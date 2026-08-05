/**
 * Where an HS/HSN customs code actually lives, and how to find it.
 *
 * Medusa carries `hs_code` on THREE core models — the product variant, the
 * inventory item behind that variant, and the parent product. Merchants
 * legitimately fill in whichever level matches how they manage the item, so a
 * consumer that reads only one of them will declare "no HSN" for catalogue that
 * has a perfectly good code one level away. Shiprocket rejects every
 * international shipment with a missing HSN, so that miss is a hard failure.
 *
 * This module is the single definition of the precedence chain. Both the
 * shipment builder (which READS a code at label time) and the HS-code tooling
 * (which WRITES one) go through it, so a write always lands where the label
 * looks. Pure and dependency-free — no container, no I/O.
 */

/** The catalogue levels an HS code can be stored at, most specific first. */
export type HsCodeLevel = "variant" | "inventory_item" | "product"

/** Trimmed value, or undefined when absent/blank — "" must not win the chain. */
export const nonEmptyCode = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
  return s.length ? s : undefined
}

/** The shape `resolveVariantHsCode` needs; a superset of it is fine. */
export type VariantLike = {
  id?: string | null
  hs_code?: string | null
  manage_inventory?: boolean | null
  product?: { hs_code?: string | null } | null
  inventory_items?: Array<{
    inventory_item_id?: string | null
    inventory?: { id?: string | null; hs_code?: string | null } | null
  }> | null
}

export type ResolvedHsCode = {
  /** The effective code, or undefined when no level supplies one. */
  hs_code?: string
  /** Which level it came from; undefined when unresolved. */
  level?: HsCodeLevel
}

/**
 * Resolve the effective HS code for a variant.
 *
 * Precedence: `variant.hs_code` → first non-empty
 * `variant.inventory_items[].inventory.hs_code` → `variant.product.hs_code`.
 */
export function resolveVariantHsCode(
  variant: VariantLike | null | undefined
): ResolvedHsCode {
  if (!variant) {
    return {}
  }

  const own = nonEmptyCode(variant.hs_code)
  if (own) {
    return { hs_code: own, level: "variant" }
  }

  for (const link of variant.inventory_items || []) {
    const code = nonEmptyCode(link?.inventory?.hs_code)
    if (code) {
      return { hs_code: code, level: "inventory_item" }
    }
  }

  const fromProduct = nonEmptyCode(variant.product?.hs_code)
  if (fromProduct) {
    return { hs_code: fromProduct, level: "product" }
  }

  return {}
}

/**
 * Where a NEW code for this variant should be written.
 *
 * The rule the platform operator specified: a variant that manages its own
 * inventory has an inventory item that is the natural home for customs data;
 * a variant that doesn't is really just an option of the product, so the code
 * belongs at the product top level where it covers every sibling variant at
 * once. Writing per-variant on an unmanaged product means N rows to maintain
 * and N chances for one to drift.
 *
 * Returns the level plus the id to write against, so a caller never has to
 * re-derive the pairing.
 */
export function suggestHsCodeTarget(
  variant: VariantLike | null | undefined,
  productId?: string | null
): { level: HsCodeLevel; id: string } | null {
  if (!variant) {
    return null
  }

  const inventoryId = (variant.inventory_items || [])
    .map((l) => l?.inventory?.id || l?.inventory_item_id)
    .find(Boolean)

  if (variant.manage_inventory && inventoryId) {
    return { level: "inventory_item", id: String(inventoryId) }
  }

  if (productId) {
    return { level: "product", id: String(productId) }
  }

  return variant.id ? { level: "variant", id: String(variant.id) } : null
}
