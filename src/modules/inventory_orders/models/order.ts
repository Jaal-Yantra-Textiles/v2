import { model } from "@medusajs/framework/utils";
import OrderLine from "./orderline";

const InventoryOrder = model.define("inventory_orders", {
  id: model.id({prefix: 'inv_order'}).primaryKey(),
  quantity: model.float(),
  total_price: model.bigNumber(),
  status: model.enum([
    "Pending",
    "Processing",
    "Shipped",
    "Delivered",
    "Cancelled",
    "Partial"
  ]).default("Pending"),
  expected_delivery_date: model.dateTime(),
  order_date: model.dateTime(),
  orderlines: model.hasMany(() => OrderLine),
  metadata: model.json().nullable(),
  shipping_address: model.json().nullable(),
  is_sample: model.boolean().default(false),
}).cascades({
  delete: ['orderlines']
});

export default InventoryOrder;
