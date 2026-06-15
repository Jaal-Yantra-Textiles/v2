// #342 — derive a unified order's "kind" on the partner order detail.
//
// `metadata.kind` was retired (Chunk 6); the order↔execution links are the sole
// discriminator. The detail route attaches the reverse accessors
// (`production_runs` / `inventory_orders`) to the order — 1:1 links resolve to a
// single `{ id }` object, but tolerate an array too. `legacy_id` (the
// production_run id for design, the inventory_order id for inventory) is the
// pointer the work hooks/endpoints key off.

export type OrderKind = "retail" | "design" | "inventory"

const linked = (rel: any): boolean =>
  Array.isArray(rel) ? rel.length > 0 : Boolean(rel?.id)

export const useOrderKind = (order: any) => {
  const kind: OrderKind = linked(order?.production_runs)
    ? "design"
    : linked(order?.inventory_orders)
    ? "inventory"
    : "retail"

  const legacyId: string | undefined = order?.metadata?.legacy_id

  return {
    kind,
    legacyId,
    isWorkOrder: kind !== "retail",
  }
}
