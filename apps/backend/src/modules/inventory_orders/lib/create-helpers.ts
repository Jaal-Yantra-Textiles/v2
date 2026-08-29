import { MedusaError } from "@medusajs/framework/utils"

/**
 * Pure helpers for creating an inventory order together with its lines (#778 C3).
 *
 * Kept free of any container / service dependency so they're unit-testable, and
 * shared between the module service (`createInvWithLines`) and the create
 * workflow's linking step.
 */

export type CreateOrderLineInput = {
  inventory_id: string
  quantity: number
  price: number
  metadata?: Record<string, unknown>
  // Batch tag for separate-batch quick-add lines (null ⇒ not batched).
  batch_number?: number | null
  // #817 S2 — color identity denormalized off the line's inventory_item.
  color?: string | null
  material_name?: string | null
  raw_material_id?: string | null
}

export type OrderLinePayload = {
  quantity: number
  price: number
  metadata: Record<string, unknown> | null
  inventory_orders: string
  batch_number: number | null
  // #817 S2 — persisted denormalized color identity (null when the line's
  // inventory_item has no linked raw_material).
  color: string | null
  material_name: string | null
  raw_material_id: string | null
}

/** The line ↔ inventory-item pairing used to create the module links. */
export type LineItemPair = {
  order_line_id: string
  inventory_item_id: string
}

/**
 * Sum the per-unit line prices into an order total (#778 H9).
 *
 * `price` is the PER-UNIT price (matches the admin UI, validators, and registry
 * cost reads), so each line contributes `price × quantity`. Used as the fallback
 * order total when a caller (e.g. a visual flow) omits `total_price`.
 */
export const sumLineTotals = (
  order_lines: Pick<CreateOrderLineInput, "price" | "quantity">[]
): number =>
  order_lines.reduce(
    (sum, l) => sum + (Number(l.price) || 0) * (Number(l.quantity) || 0),
    0
  )

/** Build the persistence payloads for the order lines of one inventory order. */
export const buildOrderLinePayloads = (
  order_lines: CreateOrderLineInput[],
  orderId: string
): OrderLinePayload[] =>
  order_lines.map((line) => ({
    quantity: line.quantity,
    price: line.price,
    metadata: line.metadata ?? null,
    inventory_orders: orderId,
    batch_number: line.batch_number ?? null,
    // #817 S2 — pass through the denormalized color identity resolved by the
    // caller (the create step), defaulting to null when absent.
    color: line.color ?? null,
    material_name: line.material_name ?? null,
    raw_material_id: line.raw_material_id ?? null,
  }))

/** Denormalized color identity for one inventory_item's linked raw_material. */
export type MaterialInfo = {
  color: string | null
  material_name: string | null
  raw_material_id: string | null
}

/**
 * Shape of an inventory_item as returned by query.graph with the
 * `raw_materials` link fields selected. The link is 1:1 but graph results can
 * come back either as an object or a single-element array, so both are handled.
 */
export type InventoryItemWithMaterial = {
  id: string
  raw_materials?:
    | { id?: string | null; color?: string | null; name?: string | null }
    | { id?: string | null; color?: string | null; name?: string | null }[]
    | null
}

/**
 * Build an `inventory_item_id → MaterialInfo` lookup from query.graph results,
 * so the create step can denormalize color identity onto each order line
 * (#817 S2). Items with no linked raw_material simply map to all-null.
 */
export const buildMaterialLookupByInventoryId = (
  inventoryItems: InventoryItemWithMaterial[]
): Record<string, MaterialInfo> => {
  const lookup: Record<string, MaterialInfo> = {}
  for (const item of inventoryItems ?? []) {
    if (!item?.id) continue
    const rm = Array.isArray(item.raw_materials)
      ? item.raw_materials[0]
      : item.raw_materials
    lookup[item.id] = {
      color: rm?.color ?? null,
      material_name: rm?.name ?? null,
      raw_material_id: rm?.id ?? null,
    }
  }
  return lookup
}

/**
 * Merge the resolved color identity onto each order line by inventory_item id.
 * Lines whose item isn't in the lookup are left as-is (fields stay undefined →
 * persisted as null by buildOrderLinePayloads).
 */
export const enrichOrderLinesWithMaterial = (
  order_lines: CreateOrderLineInput[],
  lookup: Record<string, MaterialInfo>
): CreateOrderLineInput[] =>
  order_lines.map((line) => {
    const info = lookup[line.inventory_id]
    return info ? { ...line, ...info } : line
  })

/**
 * Pair each created order line to the inventory item it was created from, by
 * position. Safe only because the order and its lines are now created
 * atomically in one transaction (#778 C3) — the created lines come back 1:1 and
 * in input order, so position `i` always corresponds to `order_lines[i]`.
 *
 * The OrderLine model has no column for the inventory item id (the relationship
 * lives entirely in the module link), so the pairing is computed here, at
 * creation time, while the correspondence is still known — rather than being
 * re-derived downstream by zipping two independently-built arrays by index
 * (the original bug: a dropped line shifted every later pairing onto the wrong
 * item). Guards the length invariant and throws rather than silently
 * mis-pairing if the counts ever diverge.
 */
export const buildInventoryLineLinkPairs = (
  createdLines: { id: string }[],
  order_lines: CreateOrderLineInput[]
): LineItemPair[] => {
  if (createdLines.length !== order_lines.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Inventory order line count mismatch: created ${createdLines.length} lines for ${order_lines.length} inputs`
    )
  }
  return createdLines.map((line, i) => ({
    order_line_id: line.id,
    inventory_item_id: order_lines[i].inventory_id,
  }))
}

/** One order line as the material backfill sees it (#1613 scope item 4). */
export type OrderLineForMaterialBackfill = {
  id: string
  color?: string | null
  material_name?: string | null
  raw_material_id?: string | null
  /** The linked inventory item, as `query.graph` returns the link. */
  inventory_items?: Array<{ id?: string | null } | null> | null
}

/** A field the backfill would write on one line, and what it would write. */
export type MaterialBackfillChange = {
  line_id: string
  inventory_item_id: string
  field: keyof MaterialInfo
  after: string
}

/**
 * ⚠️ Missing, for a denormalized text column, is null OR the empty string.
 *
 * A CHECK that asked `is not null` once passed a row holding `''` (#1613's
 * sibling lesson), and a line whose `material_name` is `""` is exactly as unable
 * to say what it is for as one holding null — while `!= null` would call it
 * populated and skip it forever.
 */
const isMissing = (value: unknown): boolean =>
  value == null || String(value).trim() === ""

/**
 * PURE: what the material backfill would write, per line (#1613 scope item 4).
 *
 * ## The gap
 *
 * `color` / `material_name` / `raw_material_id` are denormalized onto the line
 * at CREATE time (#817 S2) from the linked inventory item's raw material. Lines
 * written before that shipped have all three NULL — all ten on
 * `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` do — so the order cannot say what
 * material any line is for. The 20 Jul 2026 order has them populated, which is
 * how we know #817 works and this is a historical population only.
 *
 * ## Why it is safe to write, unlike the rest of #1613
 *
 * Nothing is inferred. The values come from `buildMaterialLookupByInventoryId`
 * — the SAME function the create path uses — reading the module link that has
 * been the source of truth all along. A backfilled line therefore holds exactly
 * what a line created today would hold, rather than a second opinion about it.
 *
 * ## What it refuses to do
 *
 *  - **Never overwrite a value that is already there.** A populated field is
 *    someone's answer; the link is the source of truth for a line that never
 *    got one, not a licence to correct one that did. Per FIELD, not per line —
 *    a line with a colour but no material name gets the name and keeps the
 *    colour.
 *  - **Never write a null.** An item with no linked raw material leaves the
 *    line alone: absence there is not repairable, and writing null over null
 *    is a change that reports work and does none.
 *  - **Never guess the item.** A line whose link resolves to nothing is
 *    skipped. ⚠️ `query.graph` returns ONE all-null row for an empty relation,
 *    so `inventory_items.length` is 1 for a line with no link at all — the
 *    filter below is what stops that phantom becoming an id of `"null"`.
 */
export const planMaterialBackfill = (
  orderlines: OrderLineForMaterialBackfill[] | null | undefined,
  lookup: Record<string, MaterialInfo>
): MaterialBackfillChange[] => {
  const changes: MaterialBackfillChange[] = []

  for (const line of (orderlines || []).filter(Boolean)) {
    const itemId = (line.inventory_items || []).find((i) => i?.id)?.id
    if (!itemId) continue

    const info = lookup[String(itemId)]
    if (!info) continue

    for (const field of ["color", "material_name", "raw_material_id"] as const) {
      const proposed = info[field]
      // Nothing to say, or the line already says something — leave it.
      if (isMissing(proposed)) continue
      if (!isMissing(line[field])) continue

      changes.push({
        line_id: String(line.id),
        inventory_item_id: String(itemId),
        field,
        after: String(proposed),
      })
    }
  }

  return changes
}
