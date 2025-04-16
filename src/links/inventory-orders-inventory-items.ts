import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import InventoryModule from "@medusajs/medusa/inventory";

/**
 * Links each inventory order line to a single inventory item.
 * This enables loose coupling between order lines and inventory items across modules.
 */
export default defineLink(
  InventoryOrdersModule.linkable.inventoryOrderLine,
  {
    linkable: InventoryModule.linkable.inventoryItem,
    isList: false, // Each order line links to one inventory item
  }
);
