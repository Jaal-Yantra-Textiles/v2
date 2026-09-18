/**
 * @file Partner API route for PROPOSING a tax charge on an assigned inventory order
 * @description A partner stages a `tax` amount on top of the goods. Nothing is
 * applied here — the proposal waits for an admin approval (post-ship) that turns
 * it into a real `inventory_order_charge`, which is what raises the payable
 * ceiling. A partner may only propose `tax`; discounts/adjustments (which lower
 * what they are owed) and shipping are not theirs to set.
 * @module API/Partners/InventoryOrders
 */

/**
 * @route POST /partners/inventory-orders/:orderId/charges
 * @group InventoryOrders
 * @param {string} orderId.path.required - The assigned inventory order to propose a charge on
 * @returns {Object} 200 - { change } the pending proposal including the new tax
 * @throws 401 - Partner authentication required
 * @throws 404 - Inventory order not found (or not owned by this partner)
 * @throws 400 - Order is no longer editable, or body is not a positive `tax` amount
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { getPartnerFromAuthContext } from "../../../helpers"
import { serializeChange } from "../../../../../modules/inventory_orders/lib/order-changes"
import { stageInventoryOrderChangeWorkflow } from "../../../../../workflows/inventory_orders/stage-inventory-order-change"
import type { PartnerAddOrderCharge } from "../../change-schemas"

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const orderId = req.params.orderId

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const payload = (req.validatedBody ?? req.body ?? {}) as PartnerAddOrderCharge
  const charges = [{ type: "tax" as const, amount: payload.amount, note: payload.note ?? null }]

  const { result, errors } = await stageInventoryOrderChangeWorkflow(
    req.scope
  ).run({
    input: {
      orderId,
      partnerId: partner.id,
      charges,
    },
  })

  if (errors && errors.length > 0) {
    throw errors[0].error
  }

  return res.status(200).json({ change: serializeChange((result as any)?.change) })
}