import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"

import { getPartnerFromAuthContext } from "../../helpers"
import { listPayableInventoryOrders } from "../../../../workflows/payment_submissions/lib/payable-inventory-orders"

/**
 * GET /partners/payment-submissions/payable-inventory-orders
 *
 * The inventory orders this authenticated partner can bill us for — material
 * we bought FROM them, as opposed to work they did for us.
 *
 * ## Why this exists (#1710)
 *
 * The admin has offered these since #1612. A partner never could: the partner
 * create validator accepts `design_ids` and `task_ids` and nothing else, and no
 * partner screen listed an inventory order at all. So the one party who knows
 * what they delivered had to ask an admin to bill on their behalf — and the
 * only self-serve path, `POST /partners/inventory-orders/:id/submit-payment`,
 * writes an `internal_payments` row that is not a claim and that no payout ever
 * accounts for. That is where the two INR 10,000 rows behind #1710 came from.
 *
 * 🔑 Identical answer to the admin route, from the same lib. The partner id
 * comes from the AUTH CONTEXT rather than the query string, which is the whole
 * of the difference and also the whole of the security boundary: there is no
 * `partner_id` parameter here to tamper with.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<never>,
  res: MedusaResponse
) => {
  if (!req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no actor ID"
    )
  }

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required - no partner found"
    )
  }

  const payable_inventory_orders = await listPayableInventoryOrders(
    req.scope,
    partner.id
  )

  return res.status(200).json({
    payable_inventory_orders,
    count: payable_inventory_orders.length,
  })
}
