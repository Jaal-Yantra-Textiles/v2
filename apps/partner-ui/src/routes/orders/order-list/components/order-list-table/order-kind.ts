// #342 Chunk 5 — the partner orders surface is split by "kind" (which unified
// link is present): retail customer orders vs design/inventory work-orders. The
// kind is derived from the route segment after `/orders` and drives both the
// standard `OrderListTable` and the experimental `ConfigurableOrderListTable`
// (so the configurable table filters natively by kind instead of deferring to
// the standard one). Shared here to keep the two tables in lockstep.

export type OrderKind = "retail" | "design" | "inventory" | "all"

// `/orders` (index) == retail; `/orders/{design,inventory,all}` opt into the
// other unified panels. The detail route `/orders/:id` renders a different
// component, so the segment after "orders" here is always a kind.
export const deriveOrderKind = (pathname: string): OrderKind => {
  const seg = pathname.split("/").filter(Boolean)[1]
  return seg === "design" || seg === "inventory" || seg === "all"
    ? (seg as OrderKind)
    : "retail"
}

// The order-kind views are reached from the nested "Orders" sidebar submenu.
// The heading reflects which kind is active.
export const KIND_HEADINGS: Record<OrderKind, string> = {
  retail: "Orders",
  design: "Design Orders",
  inventory: "Inventory Orders",
  all: "All Orders",
}

// design/inventory are PURE work-orders (no customer, sales channel, or
// payment/fulfillment) — those retail columns render empty for them. `all` mixes
// retail + work orders, so it keeps every column.
export const isPureWorkOrderKind = (kind: OrderKind): boolean =>
  kind === "design" || kind === "inventory"
