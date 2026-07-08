import { model } from "@medusajs/framework/utils"

/**
 * Maps a Faire order to the Medusa order created from it. `order_token` is
 * unique — the idempotency key so a Faire webhook retry (or a later
 * order.canceled/shipped event for the same order) never re-creates the
 * Medusa order.
 */
const FaireOrder = model.define("faire_order", {
  id: model.id().primaryKey(),
  order_token: model.text().unique(),
  order_id: model.text().nullable(), // Medusa order id
  status: model.text().default("created"),
  currency: model.text().nullable(),
  total: model.text().nullable(), // decimal string (cents as integer string)
  buyer_name: model.text().nullable(),
  raw: model.json().nullable(),
})

export default FaireOrder
