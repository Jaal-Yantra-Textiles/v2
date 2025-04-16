import { model } from "@medusajs/framework/utils";
import OrderLine from "./orderline";

const InventoryOrder = model.define("inventory_orders", {
  id: model.id().primaryKey(),
  quantity: model.number(),
  total_price: model.bigNumber(),
  status: model.enum([
    "Pending",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled"
  ]).default("Pending"),
  expected_delivery_date: model.dateTime(),
  order_date: model.dateTime(),
  orderlines: model.hasMany(() => OrderLine),
  metadata: model.json().nullable(),
  shipping_address: model.json().nullable(),
});

export default InventoryOrder;
