/**
 * One link row per line item, deterministically.
 *
 * 🔴 The defect this exists to end: `resolveLineItemDesignId` read the design
 * link with `take: 1` and NO ORDER, and this route built `sibling_items` from
 * every row it got back. Both assumed one row per line. `repointOrderItemDesign`
 * dismisses the old link and creates the new one as two separate writes, so the
 * table can hold more than one — and then:
 *
 * · the resolver returned the design the customer is NO LONGER GETTING, about
 *   half the time, from the canonical path every run-creation reads;
 * · this route rendered TWO sibling rows for one garment.
 *
 * That is the `sibling_items[0]` red on main. It was never a test-ordering
 * quirk — it is the same row-order roulette as #1983's `take:1` and #1979's
 * `stores[0]`, in the resolver that decides what a customer is having made.
 *
 * Newest wins, because a re-point writes the new row last.
 */
export type LinkRow = {
  line_item_id: string
  design_id?: string | null
  created_at?: string | Date | null
}

/** Epoch ms, or `null` when the row cannot say when it was written. */
const writtenAt = (row: LinkRow): number | null => {
  if (!row?.created_at) return null
  const t = new Date(row.created_at as any).getTime()
  return Number.isNaN(t) ? null : t
}

export const newestLinkPerLine = <T extends LinkRow>(rows: T[] | null | undefined): T[] => {
  const newest = new Map<string, T>()
  for (const row of rows ?? []) {
    if (!row?.line_item_id) continue
    const held = newest.get(row.line_item_id)
    if (!held) {
      newest.set(row.line_item_id, row)
      continue
    }
    const a = writtenAt(row)
    const b = writtenAt(held)
    // A row that cannot say when it was written never displaces one that can:
    // an unknown date is not evidence of being newer. Between two unknowns the
    // first seen is kept, so the result does not depend on arrival order.
    if (a === null) continue
    if (b === null || a >= b) newest.set(row.line_item_id, row)
  }
  return [...newest.values()]
}
