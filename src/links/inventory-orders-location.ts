import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import StockLocationModule from "@medusajs/medusa/stock-location";


/**
 * Links each inventory order line to a single inventory item.
 * This enables loose coupling between order lines and inventory items across modules.
 */
export default defineLink(
  InventoryOrdersModule.linkable.inventoryOrders,
  {
    linkable: StockLocationModule.linkable.stockLocation,
    isList: false, // Each order line links to one stock location item
  }
);
