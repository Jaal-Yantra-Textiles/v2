/**
 * @file Admin API route for APPROVING a partner's proposed inventory-order change
 * @description Promotes the staged line edits/removals and `tax` charges into the
 * real line/charge tables. This is the money decision of #1752: until this runs
 * (post-ship), a partner's proposal has not moved the payable ceiling.
 * @module API/Admin/InventoryOrders
 */

/**
 * @route POST /admin/inventory-orders/:id/changes/:changeId/approve
 * @group InventoryOrders
 * @param {string} id.path.required - The inventory order id
 * @param {string} changeId.path.required - The pending change to approve
 * @returns {Object} 200 - { change } the now-approved change
 * @throws 404 - Change not found (or not on this order)
 * @throws 400 - Change was already rejected
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ORDER_INVENTORY_MODULE } from "../../../../../../../modules/inventory_orders"
import { serializeChange } from "../../../../../../../modules/inventory_orders/lib/order-changes"
import { approveInventoryOrderChangeWorkflow } from "../../../../../../../workflows/inventory_orders/approve-inventory-order-change"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id, changeId } = req.params
  const decidedBy = (req.auth_context?.actor_id as string) || "admin"

  const { errors } = await approveInventoryOrderChangeWorkflow(req.scope).run({
    input: { orderId: id, changeId, decidedBy },
  })

  if (errors && errors.length > 0) {
    throw errors[0].error
  }

  // Re-fetch for the fresh, serialized state (the workflow returns a summary).
  const service: any = req.scope.resolve(ORDER_INVENTORY_MODULE)
  const change = await service.retrieveOrderChange(changeId)

  return res.status(200).json({ change: serializeChange(change) })
}