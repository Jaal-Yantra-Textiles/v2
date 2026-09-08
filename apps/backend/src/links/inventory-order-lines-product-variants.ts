/**
 * Inventory order line ↔ product variant (#1873).
 *
 * An inventory order line may be placed by naming a partner's product VARIANT
 * rather than an inventory item. `ensureLineInventoryItems` (#1662) resolves
 * that variant to an inventory item — creating the item and enabling tracking
 * at our end when the variant was `manage_inventory: false` — and until this
 * link existed the variant was then thrown away. The order could no longer say
 * which product it was for; prod had 65 of 65 lines item-backed and 0
 * product-backed.
 *
 * The line model's own comment ("We are linking module links to order line with
 * inventory and product") always intended this; only the inventory half was
 * ever built (`inventory-orders-inventory-items.ts`).
 *
 * A line has AT MOST one variant, and a variant may appear on many lines over
 * time — one order line is one thing ordered once, but the same variant is
 * reorderable. Raw-material lines have no link row at all: they genuinely have
 * no product, and an absent row says that more honestly than a null column.
 */
import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import ProductModule from "@medusajs/medusa/product";

export default defineLink(
  {
    linkable: InventoryOrdersModule.linkable.inventoryOrderLine,
    isList: true,
  },
  {
    linkable: ProductModule.linkable.productVariant,
    isList: false,
  }
);
