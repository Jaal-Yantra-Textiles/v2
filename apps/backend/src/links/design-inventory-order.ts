import { defineLink } from "@medusajs/framework/utils"

import DesignModule from "../modules/designs"
import InventoryOrderModule from "../modules/inventory_orders"

/**
 * The material a design is WAITING FOR (#2111).
 *
 * `design ↔ inventory_item` already says what a design is made of. It does not
 * say that 86 m of it is currently on a lorry. Until this link, the only path
 * from an arriving inventory order back to a design ran through a production
 * run — `run.depends_on_inventory_order_ids` → `run.design_id` — and that path
 * fails in the two cases that matter most:
 *
 *   1. **Exactly 1 of 146 runs on prod uses that field** (2026-09-20). For
 *      every other run the edge simply is not there to follow.
 *   2. A design that has no run yet cannot have one. The four Oshen designs are
 *      `Conceptual`; the cloth for them is commissioned long before anybody is
 *      assigned to cut it. That is precisely when a client most wants to hear
 *      that their material is moving.
 *
 * So this is the edge stated directly, and it is deliberately many-to-many: one
 * order of cloth is routinely split across a range, and one design commonly
 * waits on several orders (a cotton and a silk arriving separately).
 *
 * 🔴 It is NOT a bill of materials and must not be read as one. It says "this
 * order is FOR that design", not "this design consumes this much". Consumption
 * is the run's allocation and the consumption log, both of which are per-run
 * and carry quantities this link has no opinion about.
 */
export default defineLink(
  { linkable: DesignModule.linkable.design, isList: true },
  { linkable: InventoryOrderModule.linkable.inventoryOrders, isList: true },
  {
    database: {
      extraColumns: {
        /**
         * Whether the design's customer hears about this order.
         *
         * 🔴 A TYPED COLUMN ON THE EDGE, not a flag in anyone's `metadata`. The
         * decision "does a client get an email about this" is exactly the kind
         * of rule this codebase has been bitten by keeping in a blob — a
         * metadata-shaped write replaces the whole object, and the switch would
         * flip silently with nothing to show for it.
         *
         * Defaults to ON. The edge exists because somebody deliberately said
         * this order is for this design; the common case is that the client
         * should know. Attach with it off for cloth bought speculatively, or
         * for a client who has asked not to be told.
         */
        notify_customer: { type: "boolean", defaultValue: "true" },
        /**
         * When the "your materials have arrived" mail actually went, so the
         * same arrival is never announced twice.
         *
         * ⚠️ Needed because the upstream event does NOT give idempotency on its
         * own. It fires only when the status genuinely moved, so it cannot
         * repeat while an order sits at Delivered — but an order corrected back
         * to Shipped and then delivered again fires a second time, and the
         * client would be told twice about one arrival.
         */
        notified_at: { type: "datetime", nullable: true },
        /** Why this order was attached to this design, in a human's words. */
        note: { type: "text", nullable: true },
      },
    },
  }
)
