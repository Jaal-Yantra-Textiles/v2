/**
 * #1918 — the order's items as the design-order screen needs to see them.
 *
 * PURE: no container, no I/O. Given the order's items (already graphed) and the
 * design each resolves to, it produces the rows the UI renders — what was
 * ordered, what has actually arrived, and which design each line stands for.
 *
 * Pure because the counting is where this gets quietly wrong. Medusa keeps
 * three separate quantities per item and they do NOT nest the way the words
 * suggest: an item can be `fulfilled` without being `shipped`, and `delivered`
 * is stamped by a different flow again. Aline's order has one line delivered
 * and another shipped-but-not-delivered, so any rule that treats them as a
 * simple ladder reports her order wrong.
 */

export type OrderItemDetail = {
  /**
   * The ordered quantity, as the ORDER module records it.
   *
   * 🔴 `item.quantity` comes back NULL from `query.graph` on `order` in this
   * shape — rendered as "Ordered 0" on a screen whose whole job is ordered vs
   * delivered. Only rendering the page caught it; every test passed because the
   * fixtures set `quantity` directly. The detail row is the reliable source, so
   * both are read and whichever is present wins.
   */
  quantity?: number | string | null
  fulfilled_quantity?: number | string | null
  shipped_quantity?: number | string | null
  delivered_quantity?: number | string | null
}

export type RawOrderItem = {
  id: string
  title?: string | null
  subtitle?: string | null
  thumbnail?: string | null
  quantity?: number | string | null
  unit_price?: number | string | null
  variant_id?: string | null
  product_id?: string | null
  metadata?: Record<string, any> | null
  detail?: OrderItemDetail | null
}

/**
 * PURE: a quantity, with absence preserved.
 *
 * `Number(null)` is 0 and `Number(undefined)` is NaN. A missing
 * `delivered_quantity` means "nothing recorded", and rendering that as a hard
 * 0 alongside a real 0 hides the difference between "we know none arrived" and
 * "we never tracked it".
 */
export function readQty(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" && value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export type ItemFulfilmentState =
  | "delivered"
  | "shipped"
  | "made"
  | "outstanding"

/**
 * PURE: how far along one line actually is.
 *
 * 🔴 Read from the FURTHEST state backwards, not as a ladder. `delivered` is
 * stamped independently of `shipped` — Aline's delivered skirt has
 * `shipped_quantity: 0` — so a rule that required shipped-before-delivered
 * would report a garment the customer is holding as still outstanding.
 */
export function fulfilmentStateOf(item: RawOrderItem): ItemFulfilmentState {
  const d = readQty(item?.detail?.delivered_quantity) ?? 0
  const s = readQty(item?.detail?.shipped_quantity) ?? 0
  const f = readQty(item?.detail?.fulfilled_quantity) ?? 0
  if (d > 0) return "delivered"
  if (s > 0) return "shipped"
  if (f > 0) return "made"
  return "outstanding"
}

export const FULFILMENT_LABELS: Record<ItemFulfilmentState, string> = {
  delivered: "Delivered",
  shipped: "Shipped",
  made: "Ready",
  outstanding: "Outstanding",
}

export type OrderItemRow = {
  id: string
  title: string | null
  subtitle: string | null
  thumbnail: string | null
  /** What the customer bought. */
  ordered: number | null
  /**
   * What this line costs, per unit, as the ORDER records it.
   *
   * #1946 — the Items section used to price itself from the CART line, which
   * is the one place a re-pointed or newly ADDED line does not exist.
   */
  unit_price: number | null
  /** What has actually reached them. Null when never tracked. */
  delivered: number | null
  shipped: number | null
  fulfilled: number | null
  state: ItemFulfilmentState
  state_label: string
  /** The design this line stands for now, if any. */
  design: { id: string; name: string | null; source: string | null } | null
  /** What it was ORDERED as, when that differs from the design above. */
  original_design_id: string | null
  /**
   * Whether this line can be edited through Medusa's order-edit flow.
   * 🔴 A null `variant_id` makes that impossible — the same null that blocked
   * both production and the repair on #1918. Surfaced so the UI can say WHY a
   * line is uneditable instead of offering a button that fails.
   */
  editable: boolean
  uneditable_reason: string | null
}

export function buildOrderItemRow(
  item: RawOrderItem,
  design: { id: string; name: string | null; source: string | null } | null
): OrderItemRow {
  const state = fulfilmentStateOf(item)
  const variantId = item?.variant_id ?? null
  return {
    id: item.id,
    title: item.title ?? null,
    subtitle: item.subtitle ?? null,
    thumbnail: item.thumbnail ?? null,
    ordered: readQty(item.quantity) ?? readQty(item?.detail?.quantity),
    unit_price: readQty(item.unit_price),
    delivered: readQty(item?.detail?.delivered_quantity),
    shipped: readQty(item?.detail?.shipped_quantity),
    fulfilled: readQty(item?.detail?.fulfilled_quantity),
    state,
    state_label: FULFILMENT_LABELS[state],
    design,
    original_design_id:
      (item?.metadata?.original_design_id as string | undefined) ?? null,
    editable: Boolean(variantId),
    uneditable_reason: variantId
      ? null
      : "This line has no variant, so Medusa's order-edit flow cannot change it (#1937).",
  }
}

export type OrderItemsSummary = {
  items: OrderItemRow[]
  ordered_total: number
  delivered_total: number
  outstanding_total: number
  /** True when at least one line is still owed. */
  has_outstanding: boolean
  /**
   * The one-word verdict for the header badge.
   *
   * 🔴 NOT derivable from `has_outstanding` alone. "Nothing is outstanding" is
   * not the same as "everything arrived": a line that is MADE or SHIPPED is
   * neither owed nor delivered. Rendering the boolean as a two-way choice put
   * a green "All delivered" badge directly above "3 ordered · 0 delivered" —
   * caught by looking at the screen, not by any test.
   */
  verdict: "all_delivered" | "in_progress" | "owed"
  verdict_label: string
}

/**
 * PURE: the header line — "5 ordered, 1 delivered, 4 outstanding".
 *
 * Outstanding is counted from the STATE, not as `ordered - delivered`. A line
 * that is made or shipped but not delivered is not outstanding work even though
 * the subtraction would say it is, and telling an admin four garments are owed
 * when two are already on a van sends them chasing the wrong thing.
 */
export function summariseOrderItems(rows: OrderItemRow[]): OrderItemsSummary {
  const items = rows ?? []
  const orderedTotal = items.reduce((s, r) => s + (r.ordered ?? 0), 0)
  const deliveredTotal = items.reduce((s, r) => s + (r.delivered ?? 0), 0)
  const outstanding = items.filter((r) => r.state === "outstanding")
  const hasOutstanding = outstanding.length > 0

  // Ordered from the weakest claim upward: only say "all delivered" when every
  // ordered unit is actually accounted for as delivered.
  let verdict: OrderItemsSummary["verdict"] = "in_progress"
  if (hasOutstanding) {
    verdict = "owed"
  } else if (items.length > 0 && deliveredTotal >= orderedTotal) {
    verdict = "all_delivered"
  }

  return {
    items,
    ordered_total: orderedTotal,
    delivered_total: deliveredTotal,
    outstanding_total: outstanding.reduce((s, r) => s + (r.ordered ?? 0), 0),
    has_outstanding: hasOutstanding,
    verdict,
    verdict_label:
      verdict === "owed"
        ? `${outstanding.reduce((s, r) => s + (r.ordered ?? 0), 0)} owed`
        : verdict === "all_delivered"
          ? "All delivered"
          : "In progress",
  }
}
