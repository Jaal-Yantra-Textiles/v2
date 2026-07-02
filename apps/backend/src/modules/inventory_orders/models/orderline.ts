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
  // Batch identity for the "keep batches as separate lines" quick-add mode: when
  // a group is ordered as N distinct batches, each batch is its own line tagged
  // 1..N so it can be priced/received/tracked independently. Null ⇒ not batched
  // (a single summed line), which is the default.
  batch_number: model.number().nullable(),
  metadata: model.json().nullable(),

  // Relationship
  inventory_orders: model.belongsTo(() => Order,{
    mappedBy: "orderlines"
  })

});

export default OrderLine;