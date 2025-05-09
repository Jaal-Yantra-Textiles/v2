import { defineLink } from "@medusajs/framework/utils";
import InventoryOrdersModule from "../modules/inventory_orders";
import StockLocationModule from "@medusajs/medusa/stock-location";

export default defineLink(
  { linkable: InventoryOrdersModule.linkable.inventoryOrders, isList: true },
  { linkable: StockLocationModule.linkable.stockLocation, isList: true }
);