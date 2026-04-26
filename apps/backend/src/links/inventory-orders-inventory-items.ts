import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import InventoryModule from "@medusajs/medusa/inventory";

export default defineLink(
  {
    linkable: InventoryOrdersModule.linkable.inventoryOrderLine,
    isList: true,
  },
  {
    linkable: InventoryModule.linkable.inventoryItem,
    isList: true,
  }
);