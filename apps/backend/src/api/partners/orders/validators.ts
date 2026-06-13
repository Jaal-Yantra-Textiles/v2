import { z } from "@medusajs/framework/zod"

// Chunk 5 (T3.4, #342): the `?kind=` discriminator for GET /partners/orders.
//
// Mirrors the admin contract (src/api/admin/orders/validators.ts) so the
// partner orders surface tells apart the same three kinds of `order` row by
// which execution link is present (D5):
//   - design     → linked to a production_run   (order-production-run.ts)
//   - inventory  → linked to an inventory_order (order-inventory-order.ts)
//   - retail     → NEITHER link (a real customer order in the partner's channel)
//
// Difference from admin: the partner side scopes work-orders through the D3
// `partner ↔ order` link (a partner can serve another partner's store, so
// sales-channel scoping is wrong for work). Retail stays sales-channel-scoped.
//
// Unset → `retail` (parity with admin's "customer orders" default). `all`
// surfaces retail ∪ this partner's work-orders.
//
// Parsed inside the route (not a validateAndTransformQuery middleware): `kind`
// is not a filterable order field and must not reach the orders workflow's
// filters — it is stripped and translated into an `id`/channel constraint.
export const PartnerGetOrdersKindParam = z.object({
  kind: z.enum(["retail", "design", "inventory", "all"]).optional(),
})

export type PartnerOrderKind = NonNullable<
  z.infer<typeof PartnerGetOrdersKindParam>["kind"]
>
