/**
 * @file Admin API route for listing an inventory order's proposed changes
 * @description Read-only: the pending/approved/rejected partner revisions staged
 * against an order (#1752). The approve/reject routes act on these.
 * @module API/Admin/InventoryOrders
 */

/**
 * @route GET /admin/inventory-orders/:id/changes
 * @group InventoryOrders
 * @param {string} id.path.required - The inventory order id
 * @returns {Object} 200 - { changes } newest first
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders"
import { serializeChange } from "../../../../../modules/inventory_orders/lib/order-changes"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(ORDER_INVENTORY_MODULE)

  const [order] = (await service.listInventoryOrders({
    id: [req.params.id],
  })) as any[]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${req.params.id} not found`
    )
  }

  const changes = (await service.listOrderChanges({
    inventory_orders_id: req.params.id,
  })) as any[]

  const sorted = changes
    .map((c: any) => serializeChange(c))
    .sort((a: any, b: any) =>
      String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? ""))
    )

  return res.status(200).json({ changes: sorted })
}