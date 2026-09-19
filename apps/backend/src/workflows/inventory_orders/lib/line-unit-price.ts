/**
 * The one rule for what an inventory order line is WORTH per unit.
 *
 * 🔴 `price` is only the goods half. `extra_cost` is the per-unit colour/dye/
 * finishing charge, and it is part of the agreed unit value: `total_price` is
 * folded at write time as Σ((price + extra_cost) × quantity), and that is what
 * the admin create/edit forms show and what the partner is paid.
 *
 * This exists because the rule had FOUR homes and one of them disagreed.
 * `dual-write-unified-order` folds `extra_cost` into the unified order's
 * mirrored unit price at CREATE; `reproject-inventory-mirror-items`, which runs
 * on every LINE EDIT, wrote `line.price` alone — so the first edit of a dyed
 * order silently stripped the whole job cost back out of the mirror. On the GOF
 * order that was ₹8,208 (68.4 dyed metres × ₹120), and a 5% tax computed off
 * the understated mirror would have read ₹2,389 against the ₹2,800 actually
 * invoiced — wrong, and plausible. See #2172.
 *
 * ⚠️ A caller cannot add a field its query never fetched. Whatever reads a line
 * for money must SELECT `extra_cost` explicitly; an omitted column arrives as
 * `undefined` here and folds in as 0, which is indistinguishable from a line
 * with no colour job. Same trap as `valueInventoryOrderByReceipts` (#1612).
 */

export type PricedInventoryLine = {
  price?: number | string | null
  extra_cost?: number | string | null
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** PURE: the landed per-unit price of a line — goods plus its per-unit job cost. */
export function inventoryLineUnitPrice(line: PricedInventoryLine): number {
  return num(line?.price) + num(line?.extra_cost)
}
