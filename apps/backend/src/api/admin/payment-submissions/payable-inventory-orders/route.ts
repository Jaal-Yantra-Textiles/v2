import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { listPayableInventoryOrders } from "../../../../workflows/payment_submissions/lib/payable-inventory-orders"

/**
 * GET /admin/payment-submissions/payable-inventory-orders?partner_id=…
 *
 * What a partner is owed for GOODS, as opposed to for work.
 *
 * ## Why this exists
 *
 * An inventory order is goods coming IN; a production run is the WORK. Both are
 * things a partner is paid for, and `create` has accepted
 * `inventory_order_lines` — with a validator, a partner-ownership guard and
 * read-side resolution — since #1612. Nothing ever sent one, because no screen
 * offered them: on production, NO payment carries an `inventory_order_id`. A
 * capability with no way to reach it is a capability nobody has.
 *
 * ## Where the answer lives
 *
 * 🔑 In `lib/payable-inventory-orders`, not here. The partner portal asks the
 * same question of its own orders (#1710) and a second copy of "what is this
 * order worth, and how much of it is already claimed" is a second place for the
 * receipts rule, the ordered-total ceiling and the cap flag to drift apart.
 * This route is now just the admin DOOR: read `partner_id`, refuse without it.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(
    (req.validatedQuery as any)?.partner_id ??
      (req.query as any)?.partner_id ??
      ""
  ).trim()

  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required"
    )
  }

  const payable_inventory_orders = await listPayableInventoryOrders(
    req.scope,
    partnerId
  )

  return res.status(200).json({
    payable_inventory_orders,
    count: payable_inventory_orders.length,
  })
}
