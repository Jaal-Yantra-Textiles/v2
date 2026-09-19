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
 * @route GET /partners/inventory-orders/:orderId/charges
 * @group InventoryOrders
 * @param {string} orderId.path.required - The assigned inventory order to read charges for
 * @returns {Object} 200 - { charges, totals, goods_total, payable_ceiling }
 * @throws 401 - Partner authentication required
 * @throws 404 - Inventory order not found (or not owned by this partner)
 *
 * The APPLIED charges on the order, and what they make it worth.
 *
 * 🔴 Until this existed the partner surface was WRITE-ONLY: a partner could
 * POST a proposed `tax` and then never see what an admin actually applied. The
 * figure showed in the pending-change banner and vanished the moment it was
 * approved — visible while provisional, invisible once real. The GOF order
 * carried 2,800 of IGST and 60 of packing that its own supplier could not read
 * back off any screen.
 *
 * ⚠️ Folds through `foldOrderCharges` / `orderPayableCeiling` — the SAME pure
 * lib the admin route and the payable guard use. The direction rule (tax and
 * shipping raise, discount and adjustment lower) is never restated here; a
 * second copy is how the screen and the guard start disagreeing to the paisa.
 *
 * Read-only. Applying a charge stays an admin decision.
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
import {
  assertPartnerOwnsInventoryOrder,
  getPartnerFromAuthContext,
} from "../../../helpers"
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders"
import {
  chargeDirection,
  foldOrderCharges,
  orderPayableCeiling,
} from "../../../../../modules/inventory_orders/lib/order-charges"
import { serializeChange } from "../../../../../modules/inventory_orders/lib/order-changes"
import { stageInventoryOrderChangeWorkflow } from "../../../../../workflows/inventory_orders/stage-inventory-order-change"
import type { PartnerAddOrderCharge } from "../../change-schemas"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const orderId = req.params.orderId

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  /**
   * 404s rather than 403s on someone else's order — the whole partner surface
   * leaks nothing about other tenants by status code (#778/#780).
   */
  await assertPartnerOwnsInventoryOrder(req.scope, orderId, partner.id)

  const service: any = req.scope.resolve(ORDER_INVENTORY_MODULE)

  const [order] = (await service.listInventoryOrders({ id: [orderId] })) as any[]

  const charges = (await service.listOrderCharges({
    inventory_orders_id: orderId,
  })) as any[]

  /**
   * `direction` rides along so a UI can sign a row without owning the rule.
   */
  const decorated = charges.map((charge) => ({
    ...charge,
    direction: chargeDirection(charge),
  }))

  return res.status(200).json({
    charges: decorated,
    totals: foldOrderCharges(charges),
    goods_total: Number(order?.total_price ?? 0),
    payable_ceiling: orderPayableCeiling(order, charges),
  })
}

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