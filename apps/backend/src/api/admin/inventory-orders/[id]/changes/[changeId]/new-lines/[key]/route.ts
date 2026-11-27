/**
 * @file Admin API route for sorting ONE partner-proposed new item (#2659)
 * @description A partner's proposal may name cloth the order does not list
 * (`new_material` lines, from the mobile app). Before approving, an admin can
 * rename/recolour one of those items or drop it, so approval only creates the
 * inventory items that are actually wanted. Nothing is created here — the
 * staged proposal is edited in place and stays pending.
 * @module API/Admin/InventoryOrders
 */

/**
 * @route POST /admin/inventory-orders/:id/changes/:changeId/new-lines/:key
 * @group InventoryOrders
 * @param {string} id.path.required - The inventory order id
 * @param {string} changeId.path.required - The pending change
 * @param {string} key.path.required - The proposed new line's `key`
 * @returns {Object} 200 - { change } the revised pending change
 * @throws 404 - Change, or a new line with that key, not found on this order
 * @throws 400 - Change is no longer pending
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../../../../../../../modules/inventory_orders"
import {
  reviseProposedNewLine,
  serializeChange,
} from "../../../../../../../../modules/inventory_orders/lib/order-changes"
import type { ReviseProposedNewLine } from "../../../../../validators"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { id, changeId, key } = req.params
  const body = req.validatedBody as ReviseProposedNewLine

  const service: any = req.scope.resolve(ORDER_INVENTORY_MODULE)
  const change = await service.retrieveOrderChange(changeId).catch(() => null)
  if (!change || change.inventory_orders_id !== id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order change ${changeId} not found`
    )
  }
  if (change.status !== "pending") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Inventory order change ${changeId} is ${change.status}; only a pending change can be sorted`
    )
  }

  const next = reviseProposedNewLine(change.proposed_lines, key, body)
  if (!next) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No proposed new item ${key} on change ${changeId}`
    )
  }

  await service.updateOrderChanges({
    selector: { id: changeId },
    data: { proposed_lines: next },
  })
  const updated = await service.retrieveOrderChange(changeId)
  return res.status(200).json({ change: serializeChange(updated) })
}
