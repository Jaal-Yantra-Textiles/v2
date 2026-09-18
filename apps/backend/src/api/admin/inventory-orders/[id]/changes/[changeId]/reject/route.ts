/**
 * @file Admin API route for REJECTING a partner's proposed inventory-order change
 * @description Records the refusal (with a reason the partner can be shown) and
 * applies nothing. The proposal is closed; the partner may stage a fresh one.
 * @module API/Admin/InventoryOrders
 */

/**
 * @route POST /admin/inventory-orders/:id/changes/:changeId/reject
 * @group InventoryOrders
 * @param {string} id.path.required - The inventory order id
 * @param {string} changeId.path.required - The pending change to reject
 * @returns {Object} 200 - { change } the now-rejected change
 * @throws 404 - Change not found (or not on this order)
 * @throws 400 - Change was already approved
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_INVENTORY_MODULE } from "../../../../../../../modules/inventory_orders"
import { serializeChange } from "../../../../../../../modules/inventory_orders/lib/order-changes"
import { rejectInventoryOrderChangeWorkflow } from "../../../../../../../workflows/inventory_orders/reject-inventory-order-change"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id, changeId } = req.params
  const decidedBy = (req.auth_context?.actor_id as string) || "admin"
  const reason = (req.validatedBody as any)?.reason ?? (req.body as any)?.reason ?? null

  const { result, errors } = await rejectInventoryOrderChangeWorkflow(
    req.scope
  ).run({
    input: { orderId: id, changeId, decidedBy, reason },
  })

  if (errors && errors.length > 0) {
    throw errors[0].error
  }

  return res.status(200).json({ change: serializeChange((result as any)?.change) })
}