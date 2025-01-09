import { Module } from "@medusajs/framework/utils";
import OrderService from "./service";

export const ORDER_INVENTORY_MODULE = "inventory_orders";

const OrderInventoryModule = Module(ORDER_INVENTORY_MODULE, {
  service: OrderService,
});

export { OrderInventoryModule }

export default OrderInventoryModule
