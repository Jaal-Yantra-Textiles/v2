import { MedusaError } from "@medusajs/framework/utils"

/**
 * Pure helpers for #817 S3 — ordering a raw_material_group in multiple colors.
 *
 * The container-bound bits (query.graph, item creation, linking) live in the
 * workflow step; everything here is pure so it's unit-testable in isolation.
 */

/**
 * #846 — compose a distinct title/name for a per-color material created under a
 * group. Sibling colors of a group are typically added with the same base name
 * (the group/product name), which made them visually identical everywhere
 * (order-line picker, item lists). Folding the color into the title/name at
 * creation keeps each sibling distinguishable.
 *
 * Rules: prefer the provided name, else the group name; append `— <color>` when
 * a color is present and not already contained in the base (case-insensitive)
 * so we never double-append.
 */
export const buildGroupColorTitle = (
  groupName: string | undefined | null,
  providedName: string | undefined | null,
  color: string | undefined | null
): string => {
  const base = (providedName?.trim() || groupName?.trim() || "").trim()
  const c = color?.trim()
  if (!c) {
    return base
  }
  if (base.toLowerCase().includes(c.toLowerCase())) {
    return base
  }
  return base ? `${base} — ${c}` : c
}

/** One requested color line in a group order. */
export type GroupOrderLineInput = {
  raw_material_id: string
  quantity: number
  price: number
}

/** A resolved order line, once each color maps to an inventory_item. */
export type ResolvedGroupOrderLine = {
  inventory_item_id: string
  quantity: number
  price: number
}

/**
 * Build an `raw_material_id → inventory_item_id` map from the rows returned by
 * a query over the raw_material↔inventory_item link. Rows missing either id are
 * skipped. First win per raw_material_id (a color should have exactly one item).
 */
export const buildItemIdByRawMaterialId = (
  linkRows: Array<{
    raw_materials?: { id?: string | null } | null
    inventory_item?: { id?: string | null } | null
  }>
): Record<string, string> => {
  const map: Record<string, string> = {}
  for (const row of linkRows ?? []) {
    const rmId = row?.raw_materials?.id
    const itemId = row?.inventory_item?.id
    if (rmId && itemId && !map[rmId]) {
      map[rmId] = itemId
    }
  }
  return map
}

/**
 * Split requested lines into those whose color already has an inventory_item
 * and those whose item must be created first. Preserves input order.
 */
export const splitResolvedAndMissing = (
  requestedLines: GroupOrderLineInput[],
  itemIdByRawMaterialId: Record<string, string>
): { missingRawMaterialIds: string[] } => {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const line of requestedLines ?? []) {
    const id = line.raw_material_id
    if (!itemIdByRawMaterialId[id] && !seen.has(id)) {
      seen.add(id)
      missing.push(id)
    }
  }
  return { missingRawMaterialIds: missing }
}

/**
 * Fan out requested color lines into inventory-order lines, resolving each
 * color to its inventory_item via the (now-complete) map. Throws if any color
 * still lacks an item — the caller must have created all missing ones first.
 */
export const buildResolvedOrderLines = (
  requestedLines: GroupOrderLineInput[],
  itemIdByRawMaterialId: Record<string, string>
): ResolvedGroupOrderLine[] =>
  (requestedLines ?? []).map((line) => {
    const inventory_item_id = itemIdByRawMaterialId[line.raw_material_id]
    if (!inventory_item_id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `No inventory item resolved for raw_material ${line.raw_material_id}`
      )
    }
    return { inventory_item_id, quantity: line.quantity, price: line.price }
  })

/**
 * Sum the group order lines into an order total (per-unit price × quantity),
 * mirroring sumLineTotals for the inventory_orders module.
 */
export const sumGroupOrderTotal = (
  requestedLines: Pick<GroupOrderLineInput, "price" | "quantity">[]
): number =>
  (requestedLines ?? []).reduce(
    (sum, l) => sum + (Number(l.price) || 0) * (Number(l.quantity) || 0),
    0
  )

/** Total quantity across all requested color lines. */
export const sumGroupOrderQuantity = (
  requestedLines: Pick<GroupOrderLineInput, "quantity">[]
): number =>
  (requestedLines ?? []).reduce((sum, l) => sum + (Number(l.quantity) || 0), 0)
