import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"

import PartnerInventoryOrderLink from "../../../../../links/partner-inventory-order"
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders"
import { PARTNER_MODULE } from "../../../../../modules/partner"

/**
 * POST /admin/inventory-orders/:id/assign-partner  { partner_id }
 *
 * Say which partner an inventory order belongs to, and nothing else (#1737).
 *
 * ## Why this exists next to `send-to-partner`
 *
 * `POST /admin/inventory-orders/:id/send-to-partner` is the only writer of the
 * `partner-inventory-order` link, and it does far more than write it: it emits
 * `inventory_order_assigned_to_partner` (which a subscriber turns into a real
 * message to the partner) and it starts `awaitOrderStart` / `awaitOrderCompletion`,
 * async steps that park a workflow until the partner signals they have begun
 * and finished.
 *
 * That is exactly right for commissioning NEW work. It is wrong for recording
 * work that is already done: a historical order backfilled during a
 * reconciliation would message a partner about a delivery from five months ago
 * and leave a workflow waiting for them to start it — and a workflow await
 * cannot outlive 24.85 days anyway (#1547), so the park is noise that later
 * fails.
 *
 * 🔑 Without the link an order is invisible in every partner-scoped view:
 * `payable-inventory-orders` reaches orders THROUGH the partner, because there
 * is no partner column on an inventory order. So an order created for a
 * historical record and never linked is an order nobody can bill or see — the
 * capability-with-no-door shape this issue is about.
 *
 * ⚠️ This route commissions NOTHING. No event, no notification, no workflow, no
 * status change. If you are assigning work a partner has not started, use
 * `send-to-partner` — it is the one that tells them.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String(
    (req.validatedBody as any)?.partner_id ??
      (req.body as any)?.partner_id ??
      ""
  ).trim()

  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required"
    )
  }

  /**
   * 🔴 BOTH ends validated, the same rule as `/settles` and `/records-against`.
   * A request naming two ids that checks one is the #778 shape, and here the
   * unchecked id decides whose payables an order appears in.
   */
  const orderService: any = req.scope.resolve(ORDER_INVENTORY_MODULE)
  const [order] = (await orderService.listInventoryOrders({
    id: [req.params.id],
  })) as any[]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${req.params.id} not found`
    )
  }

  const partnerService: any = req.scope.resolve(PARTNER_MODULE)
  const [partner] = (await partnerService.listPartners({
    id: [partnerId],
  })) as any[]
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Partner ${partnerId} not found`
    )
  }

  /**
   * ⚠️ Refuse to move an order that already belongs to someone else. Silently
   * re-pointing it would move a debt between partners — and the previous owner
   * would simply stop seeing work they may already have billed.
   */
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: existing } = await query.graph({
    entity: PartnerInventoryOrderLink.entryPoint,
    fields: ["partner_id"],
    filters: { inventory_orders_id: req.params.id },
  })
  const current = ((existing || []) as any[])
    .map((r) => r?.partner_id)
    .filter(Boolean)
    .map(String)

  const other = current.find((id) => id !== partnerId)
  if (other) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Inventory order ${req.params.id} already belongs to partner ${other}. Reassigning it would move a debt between partners — unlink it deliberately first.`
    )
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link

  /**
   * ⚠️ `link.create` is not idempotent — a repeat raises on the composite key
   * (#1129). Dismiss first so re-stating the same fact is a no-op.
   */
  const definition = {
    [PARTNER_MODULE]: { partner_id: partnerId },
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: req.params.id },
  }
  await remoteLink.dismiss(definition).catch(() => undefined)
  await remoteLink.create(definition as any)

  return res.status(200).json({
    inventory_order_id: req.params.id,
    partner_id: partnerId,
    assigned: true,
    /** Stated plainly: nothing was commissioned and nobody was told. */
    notified: false,
  })
}
