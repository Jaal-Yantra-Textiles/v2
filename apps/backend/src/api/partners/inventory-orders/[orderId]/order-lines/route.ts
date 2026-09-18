/**
 * @file Partner API route for PROPOSING line edits on an assigned inventory order
 * @description A partner stages quantity/price edits and removals against the
 * order's existing lines. Nothing is applied here — the proposal waits for an
 * admin approval (post-ship) that promotes it into the real line table.
 * @module API/Partners/InventoryOrders
 */

/**
 * @route PUT /partners/inventory-orders/:orderId/order-lines
 * @group InventoryOrders
 * @param {string} orderId.path.required - The assigned inventory order to propose edits to
 * @returns {Object} 200 - { change } the pending proposal (full desired line set)
 * @throws 401 - Partner authentication required
 * @throws 404 - Inventory order not found (or not owned by this partner)
 * @throws 400 - Order is no longer editable (already shipped/delivered/cancelled), or a line id is not on this order
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { getPartnerFromAuthContext } from "../../../helpers"
import { serializeChange } from "../../../../../modules/inventory_orders/lib/order-changes"
import { stageInventoryOrderChangeWorkflow } from "../../../../../workflows/inventory_orders/stage-inventory-order-change"
import type { PartnerUpdateOrderLines } from "../../change-schemas"

export async function PUT(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const orderId = req.params.orderId

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const payload = (req.validatedBody ?? req.body ?? {}) as PartnerUpdateOrderLines
  const lines = payload.order_lines.map((l) => ({
    id: l.id,
    quantity: l.quantity,
    price: l.price,
    extra_cost: l.extra_cost ?? null,
    remove: !!l.remove,
  }))

  const { result, errors } = await stageInventoryOrderChangeWorkflow(
    req.scope
  ).run({
    input: {
      orderId,
      partnerId: partner.id,
      lines,
      // Staged in the SAME call as the lines, so a proposal cannot end up
      // half-written (#1752). Charges supersede the staged ones of their type.
      ...(payload.charges?.length
        ? {
            charges: payload.charges.map((c) => ({
              type: c.type,
              amount: c.amount,
              note: c.note ?? null,
            })),
          }
        : {}),
    },
  })

  if (errors && errors.length > 0) {
    throw errors[0].error
  }

  return res.status(200).json({ change: serializeChange((result as any)?.change) })
}