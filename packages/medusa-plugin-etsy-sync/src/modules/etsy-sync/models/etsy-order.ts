import { model } from "@medusajs/framework/utils"

/**
 * Maps an Etsy receipt (order) to the Medusa order we created from it.
 * `receipt_id` is unique — the idempotency key so an Etsy webhook retry (or a
 * later order.shipped/delivered event for the same receipt) never re-creates
 * the Medusa order.
 */
const EtsyOrder = model.define("etsy_order", {
  id: model.id().primaryKey(),
  receipt_id: model.text().unique(),
  order_id: model.text().nullable(), // Medusa order id
  status: model.text().default("created"),
  currency: model.text().nullable(),
  total: model.text().nullable(), // decimal string (integer column would truncate)
  buyer_name: model.text().nullable(),
  raw: model.json().nullable(),
})

export default EtsyOrder
