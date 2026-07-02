/**
 * Pure batch-expansion logic for the material-group quick-add ("mass batches").
 *
 * Given one or more selected groups, a batch count N, and whether to keep
 * batches as separate lines, produce the order-line rows to append. Kept pure
 * (no React / no network) so it's unit-testable and the control stays thin.
 *
 * Two modes:
 *  - summed (keepSeparate=false): each color → ONE line, quantity = baseQty × N,
 *    batch_number null. Deduped against lines already in the order.
 *  - separate (keepSeparate=true): each color → N lines tagged batch 1..N, each
 *    quantity = baseQty. Not deduped — the operator explicitly wants the batches.
 *
 * baseQty = group MOQ (when > 0) else 1. price = group unit_cost else 0. Both
 * stay editable in the grid afterwards. Colors without an inventory item yet are
 * skipped (the create flow needs a concrete inventory_item_id) and surfaced in
 * the summary rather than silently dropped.
 */

export type GroupColorMember = {
  inventory_item?: { id?: string | null } | null
}

export type GroupForExpansion = {
  name: string
  minimum_order_quantity?: number | null
  unit_cost?: number | null
  raw_materials?: GroupColorMember[] | null
}

export type BatchLineToAdd = {
  inventory_item_id: string
  quantity: number
  price: number
  batch_number?: number | null
}

export type ExpandSummary = {
  added: number
  colors: number
  skippedDuplicate: number
  skippedNoItem: number
  batches: number
  keepSeparate: boolean
}

export function expandGroupsToBatchLines(opts: {
  groups: GroupForExpansion[]
  existingItemIds: string[]
  batches: number
  keepSeparate: boolean
}): { lines: BatchLineToAdd[]; summary: ExpandSummary } {
  const { groups, existingItemIds, keepSeparate } = opts
  // Clamp to a sane minimum of 1 batch.
  const batches = Math.max(1, Math.floor(Number(opts.batches) || 1))

  const existing = new Set(existingItemIds)
  const lines: BatchLineToAdd[] = []
  let colors = 0
  let skippedDuplicate = 0
  let skippedNoItem = 0

  for (const group of groups) {
    const baseQty =
      group.minimum_order_quantity && group.minimum_order_quantity > 0
        ? group.minimum_order_quantity
        : 1
    const price = typeof group.unit_cost === "number" ? group.unit_cost : 0

    for (const color of group.raw_materials ?? []) {
      const itemId = color.inventory_item?.id
      if (!itemId) {
        skippedNoItem++
        continue
      }

      if (keepSeparate) {
        // N distinct batch lines — always added (batches are additive).
        for (let b = 1; b <= batches; b++) {
          lines.push({
            inventory_item_id: itemId,
            quantity: baseQty,
            price,
            batch_number: b,
          })
        }
        colors++
      } else {
        // One summed line per color — skip if already present in the order or a
        // sibling selected group already contributed it.
        if (existing.has(itemId)) {
          skippedDuplicate++
          continue
        }
        existing.add(itemId)
        lines.push({
          inventory_item_id: itemId,
          quantity: baseQty * batches,
          price,
          batch_number: null,
        })
        colors++
      }
    }
  }

  return {
    lines,
    summary: {
      added: lines.length,
      colors,
      skippedDuplicate,
      skippedNoItem,
      batches,
      keepSeparate,
    },
  }
}

/** Human-readable one-liner for the quick-add toast. */
export function summarizeExpansion(s: ExpandSummary, groupCount: number): string {
  const parts: string[] = []
  const groupLabel = `${groupCount} ${groupCount === 1 ? "group" : "groups"}`
  if (s.keepSeparate) {
    parts.push(
      `Added ${s.added} ${s.added === 1 ? "line" : "lines"} · ${s.colors} ${
        s.colors === 1 ? "color" : "colors"
      } × ${s.batches} ${s.batches === 1 ? "batch" : "batches"} from ${groupLabel}`
    )
  } else {
    parts.push(
      `Added ${s.added} ${s.added === 1 ? "color" : "colors"} from ${groupLabel}${
        s.batches > 1 ? ` (×${s.batches} batches summed)` : ""
      }`
    )
  }
  if (s.skippedDuplicate) {
    parts.push(`${s.skippedDuplicate} already in the order`)
  }
  if (s.skippedNoItem) {
    parts.push(`${s.skippedNoItem} without a stock item yet`)
  }
  return parts.join(" · ")
}
