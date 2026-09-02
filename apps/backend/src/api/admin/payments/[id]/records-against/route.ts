import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { Link } from "@medusajs/modules-sdk"

import InventoryOrdersInternalPaymentsLink from "../../../../../links/inventory-orders-internal-payments"
import PartnerInventoryOrderLink from "../../../../../links/partner-inventory-order"
import PartnerPaymentMethodsLink from "../../../../../links/partner-payment-methods-link"
import PartnerPaymentsLink from "../../../../../links/partner-payments-link"
import { INTERNAL_PAYMENTS_MODULE } from "../../../../../modules/internal_payments"
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders"
import type InternalPaymentService from "../../../../../modules/internal_payments/service"
import { decideSamePartner, resolvePaymentOwners } from "../settles/same-partner"

/**
 * POST   /admin/payments/:id/records-against  { inventory_order_id }
 * DELETE /admin/payments/:id/records-against  { inventory_order_id }
 *
 * State that an EXISTING payment was recorded against an inventory order — or
 * take it back. The mirror of `/settles`, one entity over (#1737).
 *
 * ## Why this exists
 *
 * `inventoryOrderIds` on `POST /admin/payments/link` writes the link only at
 * CREATION. A payment already in the system can never be attached to an order
 * afterwards: `UpdatePaymentSchema` is `.strict()` and carries no link fields,
 * and `backfill-inventory-order-payment-links` only walks payments that arrived
 * through a payout, so it cannot reach a standalone one. The only workaround
 * was to delete the row and recreate it — which loses its id and its
 * `created_at`, and is the same delete-and-recreate that produced a duplicate
 * 4,500 on Sunny's ledger.
 *
 * 🔴 Measured cost of the gap. `inv_order_01K5QSCSKB4YC40ZSR47RVN80J`
 * (Shramdaan) reads `recorded_total: 0` and `payable-inventory-orders` offers
 * its full 56,856.94 as freshly billable, while 58,000 has already been paid
 * against it in two unlinked payments. The guard that would warn
 * (`recorded_total`) reads `internal_payments` on the order, and nobody could
 * put one there. A capability reachable only for rows that do not exist yet is
 * a capability nobody has (#1612).
 *
 * ## Why it is a deliberate action and not an inference
 *
 * 🔴 Nothing infers this, deliberately — the same rule `/settles` follows. A
 * payment to a partner may be an advance, a deposit, a correction, or money for
 * a different delivery. `payable-inventory-orders` REPORTS `recorded_total` and
 * refuses to subtract it, because netting silently underpays and that is this
 * codebase's recurring failure mode. This route is where a human turns the
 * report into a stated fact.
 *
 * ⚠️ Recording a payment against an order does NOT discharge a payout. It makes
 * the money visible on the order and arms the warning; `/settles` remains the
 * only thing that moves `paid`. Those are different assertions and conflating
 * them is how an advance gets read as a settlement.
 *
 * ## Scope
 *
 * ⚠️ `inventory_order` only, today. The customer-order case in #1737 needs a
 * store-order↔internal-payment link that does not exist yet — a new link table
 * and a migration — so it is deliberately NOT stubbed here. A `target_type`
 * accepting a value the route cannot honour would be worse than its absence.
 */

const resolveBoth = async (
  req: MedusaRequest,
  inventoryOrderId: string
): Promise<void> => {
  if (!inventoryOrderId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "inventory_order_id is required"
    )
  }

  /**
   * 🔴 BOTH ends validated, not just the one in the URL — the same rule as
   * `/settles`. A request naming two ids and checking one is the shape that let
   * body ids through unexamined (#778), and here the unchecked id decides which
   * order stops looking payable.
   */
  const paymentService: InternalPaymentService = req.scope.resolve(
    INTERNAL_PAYMENTS_MODULE
  )
  const [payment] = (await paymentService.listPayments({
    id: [req.params.id],
  })) as any[]
  if (!payment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Payment ${req.params.id} not found`
    )
  }

  const orderService: any = req.scope.resolve(ORDER_INVENTORY_MODULE)
  const [order] = (await orderService.listInventoryOrders({
    id: [inventoryOrderId],
  })) as any[]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Inventory order ${inventoryOrderId} not found`
    )
  }

  /**
   * ⚠️ A cancelled order was never owed, so no money can have been recorded
   * against it — the same reasoning that stops a Rejected payout being settled.
   * Allowing it would put a payment against an obligation we withdrew.
   */
  if (String(order.status) === "Cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Inventory order ${inventoryOrderId} was cancelled — it is not owed, so no payment can be recorded against it.`
    )
  }

  /**
   * 🔴 BOTH ENDS AGAINST EACH OTHER, not merely both present.
   *
   * Existence checks alone let partner A's money be recorded against partner
   * B's order. That silences the double-pay warning on an order nobody paid,
   * and leaves a link nobody would think to question. A bulk reconciliation
   * pass is exactly where an id gets typed one character wrong — this route
   * exists BECAUSE of such a pass.
   *
   * Permissive when the payment has no traceable owner; see
   * `settles/same-partner.ts` for why that is deliberate.
   */
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const owners = await resolvePaymentOwners(
    query,
    {
      partnerPayments: PartnerPaymentsLink,
      orderPayments: InventoryOrdersInternalPaymentsLink,
      partnerOrders: PartnerInventoryOrderLink,
      partnerMethods: PartnerPaymentMethodsLink,
    },
    String(req.params.id),
    /**
     * ⚠️ `paid_to` is a `belongsTo`, so an unexpanded `listPayments` returns the
     * FK column, not the object. Reading only `.paid_to.id` leaves the payment-
     * method home permanently unreached — a check that never runs reads as a
     * pass.
     */
    (payment as any)?.paid_to?.id ?? (payment as any)?.paid_to_id ?? null
  )

  /**
   * The order's partner, reached through the link — there is no partner column
   * on an inventory order.
   */
  const { data: ownerRows } = await query.graph({
    entity: PartnerInventoryOrderLink.entryPoint,
    fields: ["partner_id"],
    filters: { inventory_orders_id: inventoryOrderId },
  })
  const orderPartnerId =
    ((ownerRows || []) as any[]).map((r) => r?.partner_id).filter(Boolean)[0] ??
    null

  const decision = decideSamePartner(owners, orderPartnerId)
  if (!decision.allowed) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Payment ${req.params.id} belongs to partner ${decision.owners.join(
        ", "
      )}, but inventory order ${inventoryOrderId} belongs to partner ${orderPartnerId}. A payment cannot be recorded against another partner's order.`
    )
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const inventoryOrderId = String(
    (req.validatedBody as any)?.inventory_order_id ??
      (req.body as any)?.inventory_order_id ??
      ""
  ).trim()

  await resolveBoth(req, inventoryOrderId)

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link

  /**
   * ⚠️ `link.create` is NOT idempotent — a repeat raises on the composite
   * primary key (#1129). Dismiss first so re-stating the same fact is a no-op
   * rather than a 500 an operator reads as "it did not work".
   */
  const definition = {
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: inventoryOrderId },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: req.params.id },
  }
  await remoteLink.dismiss(definition).catch(() => undefined)
  await remoteLink.create(definition as any)

  return res.status(200).json({
    payment_id: req.params.id,
    inventory_order_id: inventoryOrderId,
    records_against: true,
  })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const inventoryOrderId = String(
    (req.query as any)?.inventory_order_id ??
      (req.body as any)?.inventory_order_id ??
      ""
  ).trim()

  await resolveBoth(req, inventoryOrderId)

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link
  await remoteLink.dismiss({
    [ORDER_INVENTORY_MODULE]: { inventory_orders_id: inventoryOrderId },
    [INTERNAL_PAYMENTS_MODULE]: { internal_payments_id: req.params.id },
  })

  return res.status(200).json({
    payment_id: req.params.id,
    inventory_order_id: inventoryOrderId,
    records_against: false,
  })
}
