import { model } from "@medusajs/framework/utils";
import Order from "./order";

const OrderLine = model.define("inventory_order_line", {
  id: model.id().primaryKey(),
  // We are linking module links to order line with inventory and product
  quantity: model.float(),
  price: model.bigNumber(),
  // #817 S2 — color identity denormalized off the linked inventory_item's
  // raw_material at creation time, so an order line is self-describing (display
  // + filtering) without re-traversing line → inventory_item → raw_material.
  // The module link stays the source of truth; these are a denormalized copy.
  color: model.text().nullable(),
  material_name: model.text().nullable(),
  raw_material_id: model.text().nullable(),
  metadata: model.json().nullable(),

  // Relationship
  inventory_orders: model.belongsTo(() => Order,{
    mappedBy: "orderlines"
  })

});

export default OrderLine;