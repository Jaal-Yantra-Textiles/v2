import { z } from "@medusajs/framework/zod"

// Chunk 4 (T3.3, #342): the `?kind=` discriminator for GET /admin/orders.
//
// The unified `order` table now holds three kinds of row, told apart by which
// execution link is present (D5):
//   - design     → linked to a production_run   (order-production-run.ts)
//   - inventory  → linked to an inventory_order (order-inventory-order.ts)
//   - retail     → NEITHER link (a real customer order)
// (Do NOT use the design↔order link to discriminate — it is shared with retail.)
//
// The admin orders list historically meant "customer orders", so it defaults to
// `retail` and hides work-orders. `?kind=` opts specific kinds back in; `all`
// restores the pre-D5 behaviour (everything, unfiltered).
//
// This is parsed inside the route override rather than wired as its own
// validateAndTransformQuery middleware: core's middleware already validates
// /admin/orders, and `kind` is not a filterable order field — it must NOT reach
// the orders workflow's filters, so we strip it here and translate it into an
// `id` constraint in the handler.
export const AdminGetOrdersKindParam = z.object({
  kind: z.enum(["retail", "design", "inventory", "all"]).optional(),
})

export type AdminOrderKind = NonNullable<
  z.infer<typeof AdminGetOrdersKindParam>["kind"]
>
