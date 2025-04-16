import { model } from "@medusajs/framework/utils";
import Order from "./order";

const OrderLine = model.define("inventory_order_line", {
  id: model.id().primaryKey(),
  // We are linking module links to order line with inventory and product
  quantity: model.number(),
  price: model.bigNumber(),
  metadata: model.json().nullable(),

  // Relationship
  inventory_orders: model.belongsTo(() => Order,{
    mappedBy: "orderlines"
  })

});

export default OrderLine;