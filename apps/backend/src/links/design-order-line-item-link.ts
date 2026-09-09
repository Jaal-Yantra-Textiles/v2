import { defineLink } from "@medusajs/framework/utils"
import DesignModule from "../modules/designs"
import OrderModule from "@medusajs/medusa/order"

/**
 * #1919 — a design bound to an ORDER line item.
 *
 * Three bindings already existed and none of them could answer "which design
 * is this item?":
 *
 *   · `design_line_item`  — design ↔ **cart** line item. Dies at checkout.
 *   · `design_order`      — design ↔ **order**. Says five designs are
 *                           involved, not which item is which.
 *   · `metadata.design_id`— a plain string on the item, written once at cart
 *                           time and never rewritten.
 *
 * A string cannot be unlinked and cannot be moved, which is why a deviated
 * order cannot be re-pointed (#1921) and why the revision lineage is invisible
 * from the order.
 *
 * `metadata.design_id` STAYS as provenance — it records what the item was
 * ordered as, which is worth keeping even after a re-point. This link records
 * what it is FOR now. When the two disagree, the link is the answer; see
 * `resolveLineItemDesignId`.
 *
 * 🔴 `isList` on both sides is deliberate. It is tempting to make this 1:1
 * because an item has one design today, but a 1:1 link makes a second
 * `remoteLink.create` a hard failure rather than a no-op — the trap that makes
 * a design unquotable when `design_product_variant` is written twice (#1918).
 * Uniqueness is enforced by reading before writing, in one place.
 */
export default defineLink(
  {
    linkable: DesignModule.linkable.design,
    isList: true,
  },
  {
    linkable: OrderModule.linkable.orderLineItem,
    isList: true,
  }
)
