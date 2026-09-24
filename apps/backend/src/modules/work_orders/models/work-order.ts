import { model } from "@medusajs/framework/utils"
import WorkOrderItem from "./work-order-item"

/**
 * #2261 / #2262 S0 — a WORK order, stored natively instead of mirrored into
 * Medusa's core `order`.
 *
 * A core order models a SALE (customer, region, tax, payment collection). A
 * work order is a PURCHASE from a partner: a production run (`kind=design`) or
 * an inventory order (`kind=inventory`). The #342 mirror faked the sale-side
 * fields — no customer, the house store's default region, `currency_assumed`,
 * a "Partner Work Orders" sales channel. This model carries only what a work
 * order actually is, and `toOrderShape()` (../lib/to-order-shape.ts) serves it
 * back in the core-order response shape so partner-ui and admin do not change.
 *
 * ## Ids are CARRIED OVER, not minted
 * The S1 backfill copies each mirror with its existing `order_…` id (and each
 * line with its `ordli_…` id). Every `unified_order_id` back-pointer, redirect
 * and bookmark keeps resolving. New rows mint with the same `order` prefix so
 * the two populations never need telling apart by id.
 *
 * ## Only what something READS is stored, and nothing in a blob
 * No `metadata`. Facts that belong to another module are not copied: the row
 * keeps the id and a READ-ONLY link follows it (`partner_id` → partner,
 * `inventory_order_id` → inventory order; see src/links/work-order-*.ts). The
 * runs a design work order holds are a real link (work_order ↔ production_runs,
 * one-to-many), the same authoritative pointer the core order uses today.
 * `toOrderShape()` synthesises the few `metadata` keys readers still use.
 *
 * ## Kind and collation are COLUMNS
 * Today kind is inferred from which order↔execution link exists, and collation
 * lives in a sidecar (`unified_order_kind`) with a metadata fallback. Here both
 * are typed and required at write time.
 */
const WorkOrder = model
  .define("work_order", {
    id: model.id({ prefix: "order" }).primaryKey(),
    /**
     * Carried over from the core mirror's `display_id` on backfill, so the
     * number the partner sees does not change. S3 owns the sequence for new rows.
     */
    display_id: model.autoincrement().searchable(),
    kind: model.enum(["design", "inventory"]),
    /**
     * `collated` — one work order holding the runs of several designs (#826).
     * `per_run` — one run. Always `per_run` for `kind=inventory`.
     */
    collation: model.enum(["collated", "per_run"]).default("per_run"),
    /** The core-order status vocabulary, so the response shape is unchanged. */
    status: model
      .enum(["pending", "completed", "draft", "archived", "canceled", "requires_action"])
      .default("pending"),
    /** Same vocabulary as `unified_order_status.partner_status`. Null = no partner-tracked state yet. */
    partner_status: model
      .enum([
        "assigned",
        "accepted",
        "in_progress",
        "finished",
        "partial",
        "completed",
        "declined",
        "cancelled",
      ])
      .nullable(),
    /** Read-only link → partner (src/links/work-order-partner.ts). */
    partner_id: model.text().nullable(),
    currency_code: model.text(),
    /**
     * For `kind=inventory`: the inventory order this work order IS.
     * Read-only link → inventory_orders (src/links/work-order-inventory-order.ts).
     */
    inventory_order_id: model.text().nullable(),
    /** The customer (retail) order that commissioned the work, if any. */
    source_order_id: model.text().nullable(),
    canceled_at: model.dateTime().nullable(),
    /** Set when a run split cancelled this order in favour of its children. */
    superseded_by_run_ids: model.array().nullable(),
    items: model.hasMany(() => WorkOrderItem, { mappedBy: "work_order" }),
  })
  .cascades({ delete: ["items"] })
  .indexes([
    { on: ["partner_id"] },
    { on: ["kind"] },
    { on: ["inventory_order_id"] },
  ])

export default WorkOrder
