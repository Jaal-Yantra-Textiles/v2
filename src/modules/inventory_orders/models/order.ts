import { model } from "@medusajs/framework/utils";

const Order = model.define("inventory_orders", {
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
  metadata: model.json().nullable(),
});

export default Order;
